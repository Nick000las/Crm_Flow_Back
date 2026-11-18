/**
 * @file Persiste códigos de recuperação e senhas em transações de autenticação.
 * @layer repository
 */
import { getAdminClient } from '#core/db/tenantClient.js';

export function withRecoveryTransaction(callback) {
  return getAdminClient().$transaction(callback);
}

export function lockRecoveryUser(tx, userId) {
  return tx.$queryRaw`
    SELECT
      id
    FROM
      usuarios
    WHERE
      id = ${userId}::uuid
    FOR UPDATE
  `;
}

export function findLatestRecoveryCode(tx, where) {
  return tx.codigoVerificacao.findFirst({ where, orderBy: { createdAt: 'desc' } });
}

export function invalidateRecoveryCodes(tx, where, now) {
  return tx.codigoVerificacao.updateMany({
    where: { ...where, usadoEm: null },
    data: { usadoEm: now },
  });
}

export function insertRecoveryCode(tx, data) {
  return tx.codigoVerificacao.create({ data, select: { id: true } });
}

export function consumeRecoveryCode(tx, where, now) {
  return tx.codigoVerificacao.updateMany({ where, data: { usadoEm: now } });
}

export function updateRecoveryPassword(tx, where, senhaHash) {
  return tx.usuario.updateMany({ where, data: { senhaHash } });
}
