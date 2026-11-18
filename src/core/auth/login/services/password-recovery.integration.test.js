import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_POLICY, PASSWORD_RECOVERY } from '#core/auth/constants.js';
import { disconnectDatabase, getAdminClient } from '#core/db/tenantClient.js';
import { sendPasswordRecoveryCode } from '#core/email/smtp.js';

import { requestPasswordRecovery, resetPassword } from './password-recovery.service.js';

vi.mock('#core/email/smtp.js', () => ({ sendPasswordRecoveryCode: vi.fn() }));

// Opt-in explícito: fixtures nunca usam o banco remoto configurado na aplicação.
const enabled = process.env.RUN_PASSWORD_RECOVERY_INTEGRATION === '1';
const tenantId = randomUUID();
const userId = randomUUID();
const email = `${userId}@example.invalid`;
const prisma = getAdminClient();

describe.skipIf(!enabled)('recuperação com PostgreSQL isolado', () => {
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL);

    if (
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      database.pathname !== '/flow_recovery_test'
    ) {
      throw new Error('Este teste exige o banco local descartável flow_recovery_test.');
    }

    await prisma.tenant.create({
      data: { id: tenantId, nome: 'Teste recuperação', subdomain: `recovery-${tenantId}` },
    });

    await prisma.usuario.create({
      data: {
        id: userId,
        tenantId,
        email,
        nome: 'Usuário teste',
        role: 'DONO',
        senhaHash: await bcrypt.hash('senha-anterior', PASSWORD_POLICY.HASH_ROUNDS),
        mfaAtivo: true,
      },
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.codigoVerificacao.deleteMany({ where: { usuarioId: userId } });
  });

  afterAll(async () => {
    if (['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }

    await disconnectDatabase();
  });

  async function requestCode() {
    await requestPasswordRecovery({ email, emailConfig: {} });

    return sendPasswordRecoveryCode.mock.calls.at(-1)[1].code;
  }

  it('armazena só hash, troca a senha e rejeita reutilização sem desligar MFA', async () => {
    const verificationCode = await requestCode();
    const record = await prisma.codigoVerificacao.findFirstOrThrow({
      where: { usuarioId: userId },
    });

    expect(record.codigoHash).not.toBe(verificationCode);
    expect(await bcrypt.compare(verificationCode, record.codigoHash)).toBe(true);

    const body = { email, verificationCode, senha: 'nova-senha-segura' };

    await resetPassword(body);

    const user = await prisma.usuario.findUniqueOrThrow({ where: { id: userId } });

    expect(await bcrypt.compare(body.senha, user.senhaHash)).toBe(true);
    expect(await bcrypt.compare('senha-anterior', user.senhaHash)).toBe(false);
    expect(user.mfaAtivo).toBe(true);
    await expect(resetPassword(body)).rejects.toMatchObject({ code: 'AUTH_INVALID_RECOVERY_CODE' });
  });

  it('serializa solicitações simultâneas e envia um único e-mail', async () => {
    await Promise.all([
      requestPasswordRecovery({ email, emailConfig: {} }),
      requestPasswordRecovery({ email, emailConfig: {} }),
    ]);

    expect(sendPasswordRecoveryCode).toHaveBeenCalledTimes(1);
    expect(await prisma.codigoVerificacao.count({ where: { usuarioId: userId } })).toBe(1);
  });

  it('só uma redefinição simultânea consome o mesmo código', async () => {
    const verificationCode = await requestCode();
    const body = { email, verificationCode, senha: 'senha-concorrente' };
    const results = await Promise.allSettled([resetPassword(body), resetPassword(body)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('limita tentativas simultâneas no banco', async () => {
    const verificationCode = await requestCode();

    await Promise.allSettled(
      Array.from({ length: PASSWORD_RECOVERY.MAX_ATTEMPTS + 1 }, () =>
        resetPassword({ email, verificationCode: '000000', senha: 'senha-bloqueada' }),
      ),
    );

    const record = await prisma.codigoVerificacao.findFirstOrThrow({
      where: { usuarioId: userId },
    });

    expect(record.tentativas).toBe(PASSWORD_RECOVERY.MAX_ATTEMPTS);

    await expect(
      resetPassword({ email, verificationCode, senha: 'senha-bloqueada' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_RECOVERY_CODE' });
  });

  it('reenvio invalida o código anterior e expiração impede a troca', async () => {
    await requestCode();

    const original = await prisma.codigoVerificacao.findFirstOrThrow({
      where: { usuarioId: userId },
    });

    await prisma.codigoVerificacao.update({
      where: { id: original.id },
      data: { createdAt: new Date(Date.now() - PASSWORD_RECOVERY.RESEND_COOLDOWN_MS - 1) },
    });

    const verificationCode = await requestCode();

    expect(
      (await prisma.codigoVerificacao.findUniqueOrThrow({ where: { id: original.id } })).usadoEm,
    ).not.toBeNull();

    await prisma.codigoVerificacao.updateMany({
      where: { usuarioId: userId, usadoEm: null },
      data: { expiraEm: new Date(0) },
    });

    await expect(
      resetPassword({ email, verificationCode, senha: 'senha-expirada' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_RECOVERY_CODE' });
  });
});
