import { getTenantClient } from '#core/db/tenantClient.js';
import { ROLES } from '#shared/constants/index.js';

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

/**
 * DONOs ativos do tenant — recebem o resumo dos leads esfriando sem
 * responsável (M9).
 *
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
export function listarDonosAtivosDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id FROM usuarios
      WHERE tenant_id = ${tenantId}::uuid AND ativo = true AND role = ${ROLES.DONO}
      ORDER BY id
    `.then((rows) => rows.map((row) => row.id)),
  );
}

/**
 * Usuários ativos com o papel — candidatos da distribuição automática (M12):
 * destino de regra, membro de grupo e o rodízio geral (DONO e OPERADOR).
 *
 * @param {string} tenantId
 * @returns {Promise<{ id: string, nome: string, role: string }[]>}
 */
export function listarUsuariosAtivosComPapel(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id::text, nome, role FROM usuarios
      WHERE tenant_id = ${tenantId}::uuid AND ativo = true
      ORDER BY id
    `,
  );
}
