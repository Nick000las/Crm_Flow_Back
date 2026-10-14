import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: `modulo_crm.crm_filter_views` (migration 0010). Views são do
 * usuário — toda query filtra `usuario_id` além de `tenant_id`.
 *
 * @typedef {import('../types/index.js').FilterView} FilterView
 */

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<FilterView[]>}
 */
export function buscarViewsDoUsuario(tenantId, usuarioId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, nome, filtros, created_at
      FROM modulo_crm.crm_filter_views
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
      ORDER BY nome
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {string} nome
 * @returns {Promise<{ id: string } | undefined>}
 */
export function buscarViewPorNome(tenantId, usuarioId, nome) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id FROM modulo_crm.crm_filter_views
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid AND nome = ${nome}
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ nome: string, filtros: object }} dados
 * @returns {Promise<FilterView>}
 */
export function criarView(tenantId, usuarioId, { nome, filtros }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.crm_filter_views (tenant_id, usuario_id, nome, filtros)
      VALUES (${tenantId}::uuid, ${usuarioId}::uuid, ${nome}, ${JSON.stringify(filtros)}::jsonb)
      RETURNING id, nome, filtros, created_at
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {string} viewId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function removerView(tenantId, usuarioId, viewId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      DELETE FROM modulo_crm.crm_filter_views
      WHERE id = ${viewId}::uuid AND tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}
