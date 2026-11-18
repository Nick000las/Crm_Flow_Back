import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_RECOVERY } from '#core/auth/constants.js';
import { sendPasswordRecoveryCode } from '#core/email/smtp.js';

import {
  getLatestCodigoVerificacao,
  getUserEmailAndPassword,
  incrementCodigoVerificacaoAttempts,
  invalidateCodigoVerificacao,
} from '../repositories/login.repository.js';
import { requestPasswordRecovery, resetPassword } from './password-recovery.service.js';
import { createRecoveryCode, replacePassword } from './password-recovery-transaction.service.js';

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }));
vi.mock('#core/email/smtp.js', () => ({ sendPasswordRecoveryCode: vi.fn() }));

vi.mock('../repositories/login.repository.js', () => ({
  getUserEmailAndPassword: vi.fn(),
  getLatestCodigoVerificacao: vi.fn(),
  incrementCodigoVerificacaoAttempts: vi.fn(),
  invalidateCodigoVerificacao: vi.fn(),
}));

vi.mock('./password-recovery-transaction.service.js', () => ({
  createRecoveryCode: vi.fn(),
  replacePassword: vi.fn(),
}));

const usuario = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'teste@example.invalid',
  ativo: true,
  role: 'DONO',
  senhaHash: 'old-hash',
  mfaAtivo: true,
};
const input = { email: usuario.email, verificationCode: '123456', senha: 'nova-senha-segura' };

beforeEach(() => {
  vi.resetAllMocks();
  getUserEmailAndPassword.mockResolvedValue(usuario);

  getLatestCodigoVerificacao.mockResolvedValue({
    id: 'code-1',
    codigoHash: 'code-hash',
    expiraEm: new Date(Date.now() + PASSWORD_RECOVERY.EXPIRATION_MS),
    usadoEm: null,
    tentativas: 0,
  });

  bcrypt.hash.mockResolvedValue('new-hash');
  bcrypt.compare.mockResolvedValue(true);
  createRecoveryCode.mockResolvedValue({ id: 'code-1' });
  incrementCodigoVerificacaoAttempts.mockResolvedValue({ count: 1 });
});

describe('recuperação de senha', () => {
  it('devolve a mesma mensagem para e-mail conhecido ou desconhecido', async () => {
    const known = await requestPasswordRecovery({ email: usuario.email, emailConfig: {} });

    getUserEmailAndPassword.mockResolvedValue(null);

    const unknown = await requestPasswordRecovery({
      email: 'ausente@example.invalid',
      emailConfig: {},
    });

    expect(unknown).toEqual(known);
    expect(sendPasswordRecoveryCode).toHaveBeenCalledTimes(1);

    expect(createRecoveryCode).toHaveBeenCalledWith(
      expect.objectContaining({ codigoHash: 'new-hash', usuario }),
    );
  });

  it.each([
    { ...usuario, ativo: false },
    { ...usuario, senhaHash: null },
    { ...usuario, role: 'INVALIDO' },
  ])('não envia para conta inelegível', async (user) => {
    getUserEmailAndPassword.mockResolvedValue(user);
    await requestPasswordRecovery({ email: usuario.email, emailConfig: {} });
    expect(createRecoveryCode).not.toHaveBeenCalled();
    expect(sendPasswordRecoveryCode).not.toHaveBeenCalled();
  });

  it('respeita o cooldown sem reenviar', async () => {
    createRecoveryCode.mockResolvedValue(null);
    await requestPasswordRecovery({ email: usuario.email, emailConfig: {} });
    expect(sendPasswordRecoveryCode).not.toHaveBeenCalled();
  });

  it('invalida código não entregue e propaga falha do SMTP', async () => {
    const failure = new Error('SMTP indisponível');

    sendPasswordRecoveryCode.mockRejectedValue(failure);

    await expect(requestPasswordRecovery({ email: usuario.email, emailConfig: {} })).rejects.toBe(
      failure,
    );

    expect(invalidateCodigoVerificacao).toHaveBeenCalledWith(
      expect.objectContaining({ codigoId: 'code-1', usuarioId: usuario.id }),
    );
  });

  it('troca a senha sem autenticar ou alterar MFA', async () => {
    await expect(resetPassword(input)).resolves.toEqual({
      message: expect.stringContaining('Senha redefinida'),
    });

    expect(getLatestCodigoVerificacao).toHaveBeenCalledWith({
      usuarioId: usuario.id,
      proposito: PASSWORD_RECOVERY.PURPOSE,
    });

    expect(replacePassword).toHaveBeenCalledWith(
      expect.objectContaining({ usuario, codigoId: 'code-1', senhaHash: 'new-hash' }),
    );

    expect(bcrypt.hash).toHaveBeenCalledWith(input.senha, expect.any(Number));
  });

  it.each([
    null,
    {
      usadoEm: new Date(),
      expiraEm: new Date(Date.now() + PASSWORD_RECOVERY.EXPIRATION_MS),
      tentativas: 0,
    },
    { usadoEm: null, expiraEm: new Date(0), tentativas: 0 },
    {
      usadoEm: null,
      expiraEm: new Date(Date.now() + PASSWORD_RECOVERY.EXPIRATION_MS),
      tentativas: PASSWORD_RECOVERY.MAX_ATTEMPTS,
    },
  ])('rejeita código ausente, consumido, expirado ou bloqueado', async (code) => {
    getLatestCodigoVerificacao.mockResolvedValue(code);

    await expect(resetPassword(input)).rejects.toMatchObject({
      code: 'AUTH_INVALID_RECOVERY_CODE',
    });

    expect(replacePassword).not.toHaveBeenCalled();
  });

  it('contabiliza a tentativa errada sem trocar senha', async () => {
    bcrypt.compare.mockResolvedValue(false);

    await expect(resetPassword(input)).rejects.toMatchObject({
      code: 'AUTH_INVALID_RECOVERY_CODE',
    });

    expect(incrementCodigoVerificacaoAttempts).toHaveBeenCalledTimes(1);
    expect(replacePassword).not.toHaveBeenCalled();
  });

  it('não compara código quando outra requisição já esgotou as tentativas', async () => {
    incrementCodigoVerificacaoAttempts.mockResolvedValue({ count: 0 });

    await expect(resetPassword(input)).rejects.toMatchObject({
      code: 'AUTH_INVALID_RECOVERY_CODE',
    });

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(replacePassword).not.toHaveBeenCalled();
  });
});
