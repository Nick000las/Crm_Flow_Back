/**
 * @file Aplica cooldown e consumo único de códigos, com troca atômica da senha.
 * @layer service
 */
import { PASSWORD_RECOVERY } from '#core/auth/constants.js';

import {
  consumeRecoveryCode,
  findLatestRecoveryCode,
  insertRecoveryCode,
  invalidateRecoveryCodes,
  lockRecoveryUser,
  updateRecoveryPassword,
  withRecoveryTransaction,
} from '../repositories/password-recovery.repository.js';

/** Serializa reenvios da mesma conta para preservar o intervalo entre códigos. */
export async function createRecoveryCode({ usuario, codigoHash, now }) {
  return withRecoveryTransaction(async (tx) => {
    await lockRecoveryUser(tx, usuario.id);

    const where = { usuarioId: usuario.id, proposito: PASSWORD_RECOVERY.PURPOSE };
    const latest = await findLatestRecoveryCode(tx, where);

    if (
      latest &&
      !latest.usadoEm &&
      now.getTime() - latest.createdAt.getTime() < PASSWORD_RECOVERY.RESEND_COOLDOWN_MS
    ) {
      return null;
    }

    await invalidateRecoveryCodes(tx, where, now);

    return insertRecoveryCode(tx, {
      ...where,
      tenantId: usuario.tenantId,
      codigoHash,
      expiraEm: new Date(now.getTime() + PASSWORD_RECOVERY.EXPIRATION_MS),
    });
  });
}

/** Consumo único e troca da senha pertencem à mesma transação. */
export async function replacePassword({ usuario, codigoId, senhaHash, now, invalidCode }) {
  return withRecoveryTransaction(async (tx) => {
    await lockRecoveryUser(tx, usuario.id);

    const consumed = await consumeRecoveryCode(
      tx,
      {
        id: codigoId,
        usuarioId: usuario.id,
        proposito: PASSWORD_RECOVERY.PURPOSE,
        usadoEm: null,
        expiraEm: { gt: now },
        tentativas: { lte: PASSWORD_RECOVERY.MAX_ATTEMPTS },
      },
      now,
    );

    if (consumed.count !== PASSWORD_RECOVERY.EXPECTED_UPDATE_COUNT) {
      throw invalidCode();
    }

    const updated = await updateRecoveryPassword(
      tx,
      { id: usuario.id, ativo: true, senhaHash: usuario.senhaHash },
      senhaHash,
    );

    if (updated.count !== PASSWORD_RECOVERY.EXPECTED_UPDATE_COUNT) {
      throw invalidCode();
    }
  });
}
