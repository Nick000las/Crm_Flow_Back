/**
 * @file ADAPTER: leitura do lead como entidade referenciada por outro módulo (M6). Mesclar não
 * reescreve mesclagens antigas (A → B, depois B → C), então o registro atual é o fim da cadeia
 * de `mesclado_em_id`. Lead na lixeira é incluído: é assim que um mesclado encontra o
 * principal.
 */
import { getTenantClient } from '#core/db/tenantClient.js';

import { FONTE_LEADS } from './crm-lead-read-model.js';

/**
 * ADAPTER: leitura do lead como entidade referenciada por outro módulo (M6).
 *
 * Mesclar não reescreve mesclagens antigas (A → B, depois B → C), então o
 * registro atual é o fim da cadeia de `mesclado_em_id`. Lead na lixeira é
 * incluído: é assim que um mesclado encontra o principal.
 *
 * @typedef {{ origem: string, atual: string, anonimizado: boolean, excluido: boolean }} Situacao
 */

/**
 * Id pedido que não existe neste tenant não volta.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<Situacao[]>}
 */
export function buscarSituacaoDasPessoas(tenantId, ids) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      WITH RECURSIVE
        cadeia AS (
          SELECT
            l.id AS origem,
            l.id AS atual,
            l.mesclado_em_id,
            l.anonimizado_em,
            l.deleted_at
          FROM
            modulo_crm.leads l
          WHERE
            l.tenant_id = ${tenantId}::uuid
            AND l.id = ANY (${ids}::UUID[])
          UNION ALL
          SELECT
            c.origem,
            m.id,
            m.mesclado_em_id,
            m.anonimizado_em,
            m.deleted_at
          FROM
            cadeia c
            JOIN modulo_crm.leads m ON m.tenant_id = ${tenantId}::uuid
            AND m.id = c.mesclado_em_id
        )
      SELECT
        origem::text,
        atual::text,
        anonimizado_em IS NOT NULL AS anonimizado,
        deleted_at IS NOT NULL AS excluido
      FROM
        cadeia
      WHERE
        mesclado_em_id IS NULL
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<Record<string, any>[]>} linhas com as colunas da leitura do lead
 */
export function buscarPessoasPorIds(tenantId, ids) {
  return getTenantClient(
    tenantId,
    async (tx) => tx.$queryRaw`
      SELECT
        l.*
      FROM
        ${FONTE_LEADS} l
      WHERE
        l.tenant_id = ${tenantId}::uuid
        AND l.id = ANY (${ids}::UUID[])
    `,
  );
}
