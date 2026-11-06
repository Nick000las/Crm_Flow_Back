import { getTenantClient } from '#core/db/tenantClient.js';
import { PAPEIS_GESTAO_KANBAN, VINCULO } from '../constants.js';

/**
 * ADAPTER: leitura e limpeza dos vínculos de card (M6). Só a referência
 * (`entidade_tipo`, `entidade_id`) mora aqui; o nome vem do módulo dono.
 *
 * Gravar o vínculo é a ação `card.link` de `kanban.repository.js`, para
 * passar pelo lock do quadro e pela participação como as outras escritas.
 */

/**
 * Cards ativos ligados a um registro, só dos quadros que o usuário vê.
 *
 * @param {import('#core/types/module.js').TenantContext} context
 * @param {{ entidadeTipo: string, entidadeId: string }} entidade
 */
export function buscarCardsVinculados({ tenantId, userId, role }, { entidadeTipo, entidadeId }) {
  const gestao = PAPEIS_GESTAO_KANBAN.includes(role);
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT c.id AS "cardId", c.titulo, c.board_id AS "boardId", b.nome AS "boardNome",
             col.nome AS "colunaNome", c.updated_at AS "updatedAt"
      FROM modulo_kanban_universal.cards c
      JOIN modulo_kanban_universal.boards b ON b.tenant_id = c.tenant_id AND b.id = c.board_id
      JOIN modulo_kanban_universal.colunas col ON col.tenant_id = c.tenant_id AND col.id = c.coluna_id
      WHERE c.tenant_id = ${tenantId}::uuid AND c.entidade_tipo = ${entidadeTipo}
        AND c.entidade_id = ${entidadeId}::uuid AND c.archived_at IS NULL
        AND (${gestao} OR EXISTS (
          SELECT 1 FROM modulo_kanban_universal.board_members bm
          JOIN public.usuarios u ON u.tenant_id = bm.tenant_id AND u.id = bm.usuario_id AND u.ativo
          WHERE bm.tenant_id = c.tenant_id AND bm.board_id = c.board_id
            AND bm.usuario_id = ${userId}::uuid
        ))
      ORDER BY c.updated_at DESC, c.id LIMIT ${VINCULO.MAX_CARDS_NA_ABA}
    `,
  );
}

/**
 * Um lote dos registros referenciados, por cursor, inclusive de cards
 * arquivados: arquivar não pode esconder um vínculo da varredura.
 *
 * @param {string} tenantId
 * @param {string} entidadeTipo
 * @param {string | null} depoisDe
 * @returns {Promise<string[]>}
 */
export async function listarEntidadesVinculadas(tenantId, entidadeTipo, depoisDe) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT DISTINCT entidade_id::text AS id FROM modulo_kanban_universal.cards
      WHERE tenant_id = ${tenantId}::uuid AND entidade_tipo = ${entidadeTipo}
        AND (${depoisDe}::uuid IS NULL OR entidade_id > ${depoisDe}::uuid)
      ORDER BY id LIMIT ${VINCULO.LOTE_VARREDURA}
    `,
  );
  return linhas.map((linha) => linha.id);
}

/**
 * Remove vínculos órfãos e troca ids mesclados, numa transação. O card fica;
 * a atividade explica o sumiço do vínculo, sem o id do registro. O filtro por
 * `entidade_id` antigo preserva um vínculo trocado durante a varredura.
 *
 * @param {string} tenantId
 * @param {string} entidadeTipo
 * @param {{ orfaos: string[], trocas: { de: string, para: string }[] }} mudancas
 * @returns {Promise<{ removidos: number, repontados: number }>}
 */
export function aplicarVarredura(tenantId, entidadeTipo, { orfaos, trocas }) {
  const detalhes = JSON.stringify({ entidadeTipo, origem: 'varredura' });
  const de = trocas.map((troca) => troca.de);
  const para = trocas.map((troca) => troca.para);

  return getTenantClient(tenantId, async (tx) => {
    const removidos = await tx.$executeRaw`
      WITH alvo AS (
        UPDATE modulo_kanban_universal.cards SET entidade_tipo = NULL, entidade_id = NULL
        WHERE tenant_id = ${tenantId}::uuid AND entidade_tipo = ${entidadeTipo}
          AND entidade_id = ANY(${orfaos}::uuid[])
        RETURNING id, board_id
      )
      INSERT INTO modulo_kanban_universal.activities (tenant_id, board_id, card_id, action, details)
      SELECT ${tenantId}::uuid, board_id, id, 'card.unlink', ${detalhes}::jsonb FROM alvo
    `;
    const repontados = await tx.$executeRaw`
      UPDATE modulo_kanban_universal.cards c SET entidade_id = t.para
      FROM unnest(${de}::uuid[], ${para}::uuid[]) AS t(de, para)
      WHERE c.tenant_id = ${tenantId}::uuid AND c.entidade_tipo = ${entidadeTipo}
        AND c.entidade_id = t.de
    `;
    return { removidos, repontados };
  });
}
