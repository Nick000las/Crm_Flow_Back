import { getAdminClient } from '#core/db/tenantClient.js';
import { PASSWORD_RECOVERY } from '#core/auth/constants.js';

/** Serializa reenvios da mesma conta para preservar o intervalo entre códigos. */
export async function createRecoveryCode({ usuario, codigoHash, now }) {
  return getAdminClient().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuario.id}::uuid FOR UPDATE`;
    const where = { usuarioId: usuario.id, proposito: PASSWORD_RECOVERY.PURPOSE };
    const latest = await tx.codigoVerificacao.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      !latest.usadoEm &&
      now.getTime() - latest.createdAt.getTime() < PASSWORD_RECOVERY.RESEND_COOLDOWN_MS
    ) {
      return null;
    }
    await tx.codigoVerificacao.updateMany({
      where: { ...where, usadoEm: null },
      data: { usadoEm: now },
    });
    return tx.codigoVerificacao.create({
      data: {
        ...where,
        tenantId: usuario.tenantId,
        codigoHash,
        expiraEm: new Date(now.getTime() + PASSWORD_RECOVERY.EXPIRATION_MS),
      },
      select: { id: true },
    });
  });
}

/** Consumo único e troca da senha pertencem à mesma transação. */
export async function replacePassword({ usuario, codigoId, senhaHash, now, invalidCode }) {
  return getAdminClient().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuario.id}::uuid FOR UPDATE`;
    const consumed = await tx.codigoVerificacao.updateMany({
      where: {
        id: codigoId,
        usuarioId: usuario.id,
        proposito: PASSWORD_RECOVERY.PURPOSE,
        usadoEm: null,
        expiraEm: { gt: now },
        tentativas: { lte: PASSWORD_RECOVERY.MAX_ATTEMPTS },
      },
      data: { usadoEm: now },
    });
    if (consumed.count !== PASSWORD_RECOVERY.EXPECTED_UPDATE_COUNT) {
      throw invalidCode();
    }
    const updated = await tx.usuario.updateMany({
      where: { id: usuario.id, ativo: true, senhaHash: usuario.senhaHash },
      data: { senhaHash },
    });
    if (updated.count !== PASSWORD_RECOVERY.EXPECTED_UPDATE_COUNT) {
      throw invalidCode();
    }
  });
}
