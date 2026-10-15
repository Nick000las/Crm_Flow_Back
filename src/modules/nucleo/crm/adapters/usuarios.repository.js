import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: leitura de `usuarios` pro CRM — só pra validar o responsável de
 * um lead. A FK `leads.usuario_responsavel_id → usuarios(id)` sozinha
 * aceitaria um usuário de OUTRO tenant; aqui o `tenant_id` (WHERE + RLS)
 * garante que o responsável é deste tenant.
 */

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function buscarUsuarioAtivoDoTenant(tenantId, usuarioId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id FROM usuarios
      WHERE id = ${usuarioId}::uuid AND tenant_id = ${tenantId}::uuid AND ativo = true
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Usuários ativos do tenant, pra escolher o responsável de um lead. Só
 * `id`/`nome` — nada de e-mail, papel ou dados de autenticação.
 *
 * @param {string} tenantId
 * @returns {Promise<{ id: string, nome: string }[]>}
 */
export function listarUsuariosAtivosDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, nome FROM usuarios
      WHERE tenant_id = ${tenantId}::uuid AND ativo = true
      ORDER BY nome
    `,
  );
}
