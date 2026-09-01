import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: único lugar deste módulo que chama getTenantClient p/ este recurso.
 * `modulo_crm.tenant_lead_field_definitions` não é `model` do Prisma (RLS
 * não é representável em Prisma Schema Language) — todo acesso é SQL cru
 * via `$queryRaw`/`$executeRaw`, tagged template, ver MODULE_CONTRACT.md §4.
 *
 * @typedef {import('../types/index.js').FieldDefinition} FieldDefinition
 * @typedef {import('../types/index.js').CriarFieldDefinitionInput} CriarFieldDefinitionInput
 * @typedef {import('../types/index.js').AtualizarFieldDefinitionInput} AtualizarFieldDefinitionInput
 */

/**
 * @param {string} tenantId
 * @returns {Promise<FieldDefinition[]>}
 */
export function buscarDefinicoesPorTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, chave, label, tipo, opcoes, obrigatorio, ordem, created_at
      FROM modulo_crm.tenant_lead_field_definitions
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY ordem
    `,
  );
}

/**
 * Usado pelo service pra checar unicidade de `chave` antes do insert e
 * devolver erro amigável, em vez de deixar o P2002 cru vazar (plano, 1.3).
 *
 * @param {string} tenantId
 * @param {string} chave
 * @returns {Promise<{ id: string } | undefined>}
 */
export function buscarDefinicaoPorChave(tenantId, chave) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id FROM modulo_crm.tenant_lead_field_definitions
      WHERE tenant_id = ${tenantId}::uuid AND chave = ${chave}
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {CriarFieldDefinitionInput} definicao
 * @returns {Promise<FieldDefinition>}
 */
export function criarDefinicao(tenantId, definicao) {
  const { chave, label, tipo, opcoes, obrigatorio, ordem } = definicao;
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.tenant_lead_field_definitions
        (tenant_id, chave, label, tipo, opcoes, obrigatorio, ordem)
      VALUES
        (${tenantId}::uuid, ${chave}, ${label}, ${tipo}, ${opcoes}::jsonb, ${obrigatorio}, ${ordem})
      RETURNING id, chave, label, tipo, opcoes, obrigatorio, ordem, created_at
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * `chave` nunca é atualizável por aqui de propósito — ela já pode estar
 * referenciada em `leads.custom_fields`, filtros salvos e mapeamento de
 * import; trocá-la por baixo quebraria tudo isso silenciosamente. Editar
 * `label`/`tipo`/`opcoes`/`obrigatorio` é seguro, renomear a chave em si
 * não é uma operação suportada nesta entrega.
 *
 * @param {string} tenantId
 * @param {string} definicaoId
 * @param {AtualizarFieldDefinitionInput} atualizacoes
 * @returns {Promise<FieldDefinition | undefined>}
 */
export function atualizarDefinicao(tenantId, definicaoId, atualizacoes) {
  const { label, tipo, opcoes, obrigatorio } = atualizacoes;
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.tenant_lead_field_definitions
      SET label = ${label}, tipo = ${tipo}, opcoes = ${opcoes}::jsonb, obrigatorio = ${obrigatorio}
      WHERE id = ${definicaoId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING id, chave, label, tipo, opcoes, obrigatorio, ordem, created_at
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Uma única transação pra tudo — evita reordenação parcial se uma das
 * atualizações falhar no meio (era o risco real do `Promise.all` com um
 * `getTenantClient` por item: cada chamada abria a própria transação).
 *
 * @param {string} tenantId
 * @param {{ id: string, ordem: number }[]} definicoesOrdenadas
 * @returns {Promise<void>}
 */
export function reordenarDefinicoes(tenantId, definicoesOrdenadas) {
  return getTenantClient(tenantId, async (tx) => {
    for (const { id, ordem } of definicoesOrdenadas) {
      await tx.$executeRaw`
        UPDATE modulo_crm.tenant_lead_field_definitions
        SET ordem = ${ordem}
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    }
  });
}

/**
 * @param {string} tenantId
 * @param {string} definicaoId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function removerDefinicao(tenantId, definicaoId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      DELETE FROM modulo_crm.tenant_lead_field_definitions
      WHERE id = ${definicaoId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}
