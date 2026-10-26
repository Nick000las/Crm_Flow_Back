import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: configuração da distribuição automática (M12, migration 0026):
 * `crm_distribuicao_config`, `crm_assignment_rule` e os grupos de usuários
 * (`crm_user_group` + membros). O ponteiro do rodízio fica em
 * `crm-rodizio.repository.js`.
 *
 * @typedef {{ ativo: boolean, fallback: string }} ConfigDistribuicaoLinha
 * @typedef {{
 *   id: string, nome: string, posicao: number, ativo: boolean,
 *   condicoes: { campoId: string, operador: string, valor?: unknown }[],
 *   destino_usuario_id: string | null, destino_grupo_id: string | null,
 * }} RegraDistribuicaoLinha
 * @typedef {{ id: string, nome: string, membros: string[] }} GrupoLinha
 * @typedef {{
 *   id?: string, nome: string, ativo: boolean,
 *   condicoes: { campoId: string, operador: string, valor?: unknown }[],
 *   destinoUsuarioId: string | null, destinoGrupoId: string | null,
 * }} RegraParaGravar
 */

/**
 * @param {string} tenantId
 * @returns {Promise<ConfigDistribuicaoLinha | undefined>}
 */
export function buscarConfigDistribuicao(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ativo, fallback FROM modulo_crm.crm_distribuicao_config
      WHERE tenant_id = ${tenantId}::uuid
    `.then((linhas) => linhas[FIRST_RESULT_INDEX]),
  );
}

/**
 * Em ordem de avaliação.
 *
 * @param {string} tenantId
 * @returns {Promise<RegraDistribuicaoLinha[]>}
 */
export function listarRegrasDistribuicao(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, nome, posicao, ativo, condicoes, destino_usuario_id, destino_grupo_id
      FROM modulo_crm.crm_assignment_rule
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY posicao, created_at
    `,
  );
}

/**
 * Config + lista inteira de regras numa transação. A ordem do array vira a
 * `posicao`; regra com `id` é atualizada (o `id` se mantém, então o
 * `leads.assigned_by_rule_id` continua valendo), sem `id` é criada, e a
 * que não veio é apagada (o lead que ela atribuiu fica com `NULL`).
 *
 * @param {string} tenantId
 * @param {ConfigDistribuicaoLinha} config
 * @param {RegraParaGravar[]} regras  `id`s já conferidos pelo service
 */
export function salvarConfigERegras(tenantId, { ativo, fallback }, regras) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_distribuicao_config (tenant_id, ativo, fallback)
      VALUES (${tenantId}::uuid, ${ativo}, ${fallback})
      ON CONFLICT (tenant_id) DO UPDATE SET ativo = EXCLUDED.ativo, fallback = EXCLUDED.fallback, updated_at = now()
    `;

    const mantidas = regras.flatMap((regra) => (regra.id ? [regra.id] : []));
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_assignment_rule
      WHERE tenant_id = ${tenantId}::uuid AND NOT (id = ANY(${mantidas}::uuid[]))
    `;

    for (const [posicao, regra] of regras.entries()) {
      const condicoes = JSON.stringify(regra.condicoes);
      if (regra.id) {
        await tx.$executeRaw`
          UPDATE modulo_crm.crm_assignment_rule
          SET nome = ${regra.nome}, posicao = ${posicao}, ativo = ${regra.ativo}, condicoes = ${condicoes}::jsonb,
              destino_usuario_id = ${regra.destinoUsuarioId}::uuid, destino_grupo_id = ${regra.destinoGrupoId}::uuid,
              updated_at = now()
          WHERE id = ${regra.id}::uuid AND tenant_id = ${tenantId}::uuid
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO modulo_crm.crm_assignment_rule
            (tenant_id, nome, posicao, ativo, condicoes, destino_usuario_id, destino_grupo_id)
          VALUES (
            ${tenantId}::uuid, ${regra.nome}, ${posicao}, ${regra.ativo}, ${condicoes}::jsonb,
            ${regra.destinoUsuarioId}::uuid, ${regra.destinoGrupoId}::uuid
          )
        `;
      }
    }
  });
}

/**
 * Grupos com os ids dos membros (todos, ativos ou não — quem filtra é o
 * service), por nome.
 *
 * @param {string} tenantId
 * @returns {Promise<GrupoLinha[]>}
 */
export function listarGrupos(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT g.id, g.nome,
             COALESCE(array_agg(m.usuario_id ORDER BY m.usuario_id) FILTER (WHERE m.usuario_id IS NOT NULL), '{}') AS membros
      FROM modulo_crm.crm_user_group g
      LEFT JOIN modulo_crm.crm_user_group_member m ON m.grupo_id = g.id
      WHERE g.tenant_id = ${tenantId}::uuid
      GROUP BY g.id, g.nome
      ORDER BY lower(g.nome)
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {{ nome: string, membros: string[] }} grupo
 * @returns {Promise<string>} id criado
 */
export function inserirGrupo(tenantId, { nome, membros }) {
  return getTenantClient(tenantId, async (tx) => {
    const [{ id }] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_user_group (tenant_id, nome)
      VALUES (${tenantId}::uuid, ${nome})
      RETURNING id
    `;
    await gravarMembros(tx, tenantId, id, membros);
    return id;
  });
}

/**
 * Nome e lista inteira de membros.
 *
 * @param {string} tenantId
 * @param {string} grupoId
 * @param {{ nome: string, membros: string[] }} grupo
 */
export function atualizarGrupo(tenantId, grupoId, { nome, membros }) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_user_group SET nome = ${nome}, updated_at = now()
      WHERE id = ${grupoId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_user_group_member
      WHERE grupo_id = ${grupoId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    await gravarMembros(tx, tenantId, grupoId, membros);
  });
}

/**
 * O ponteiro do rodízio do grupo sai junto.
 *
 * @param {string} tenantId
 * @param {string} grupoId
 */
export function excluirGrupo(tenantId, grupoId) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_rodizio_ponteiro WHERE tenant_id = ${tenantId}::uuid AND chave = ${grupoId}
    `;
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_user_group WHERE id = ${grupoId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} grupoId
 * @param {string[]} membros
 */
function gravarMembros(tx, tenantId, grupoId, membros) {
  if (membros.length === 0) return Promise.resolve(0);
  return tx.$executeRaw`
    INSERT INTO modulo_crm.crm_user_group_member (tenant_id, grupo_id, usuario_id)
    SELECT ${tenantId}::uuid, ${grupoId}::uuid, unnest(${membros}::uuid[])
    ON CONFLICT DO NOTHING
  `;
}
