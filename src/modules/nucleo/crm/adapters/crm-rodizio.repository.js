/**
 * @file Lê, bloqueia e grava o ponteiro do rodízio no banco, sem escolher candidatos.
 * @layer repository
 */
import { getTenantClient } from '#core/db/tenantClient.js';

export function withRodizioTransaction(tenantId, callback) {
  return getTenantClient(tenantId, callback);
}

export function inicializarPonteiro(tx, tenantId, chave) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_crm.crm_rodizio_ponteiro (tenant_id, chave)
    VALUES
      (${tenantId}::uuid, ${chave})
    ON CONFLICT (tenant_id, chave) DO NOTHING
  `;
}

export function lerPonteiroBloqueado(tx, tenantId, chave) {
  return tx.$queryRaw`
    SELECT
      ultimo_usuario_id::text
    FROM
      modulo_crm.crm_rodizio_ponteiro
    WHERE
      tenant_id = ${tenantId}::uuid
      AND chave = ${chave}
    FOR UPDATE
  `;
}

export function atualizarPonteiro(tx, tenantId, chave, escolhido) {
  return tx.$executeRaw`
    UPDATE modulo_crm.crm_rodizio_ponteiro
    SET
      ultimo_usuario_id = ${escolhido}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND chave = ${chave}
  `;
}
