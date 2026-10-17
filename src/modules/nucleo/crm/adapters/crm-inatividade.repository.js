import { getTenantClient } from '#core/db/tenantClient.js';
import { condicaoEsfriando } from './crm-inatividade.sql.js';

/**
 * ADAPTER: lead esfriando (M9) — os dias por status (`crm_option.stale_days`)
 * e a contagem do resumo diário. A regra do cálculo está em
 * `crm-inatividade.sql.js`.
 *
 * @typedef {{
 *   id: string, key: string, label: string, color: string | null,
 *   category: string, ativo: boolean, dias: number | null,
 * }} DiasDoStatus
 */

/**
 * Os status do tenant (ativos e inativos), na ordem configurada, com os dias.
 *
 * @param {string} tenantId
 * @returns {Promise<DiasDoStatus[]>}
 */
export function buscarDiasPorStatus(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, key, label, color, category, is_active AS ativo, stale_days AS dias
      FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'status'
      ORDER BY position, created_at, id
    `,
  );
}

/**
 * Grava os dias de cada status do mapa (`null` desliga). Keys fora do mapa
 * não mudam. Validação (key existente, categoria aberta) é do service.
 *
 * @param {string} tenantId
 * @param {Record<string, number | null>} diasPorKey
 * @returns {Promise<number>} quantas opções mudaram
 */
export function definirDiasPorStatus(tenantId, diasPorKey) {
  const entradas = Object.entries(diasPorKey);
  if (entradas.length === 0) return Promise.resolve(0);
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.crm_option o
      SET stale_days = v.dias, updated_at = now()
      FROM unnest(
        ${entradas.map(([key]) => key)}::varchar[],
        ${entradas.map(([, dias]) => dias)}::int[]
      ) AS v(key, dias)
      WHERE o.tenant_id = ${tenantId}::uuid AND o.kind = 'status' AND o.key = v.key
        AND o.stale_days IS DISTINCT FROM v.dias
    `,
  );
}

/**
 * Leads esfriando agora, contados por responsável. Sem responsável, ou com
 * o responsável desativado, cai em `usuario_id = null`.
 *
 * @param {string} tenantId
 * @param {Date} agora
 * @returns {Promise<{ usuario_id: string | null, total: number }[]>}
 */
export function contarEsfriandoPorResponsavel(tenantId, agora) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT CASE WHEN u.ativo THEN l.usuario_responsavel_id END AS usuario_id, count(*)::int AS total
      FROM modulo_crm.leads l
      LEFT JOIN usuarios u ON u.id = l.usuario_responsavel_id
      WHERE l.tenant_id = ${tenantId}::uuid AND ${condicaoEsfriando(agora)}
      GROUP BY 1
    `,
  );
}
