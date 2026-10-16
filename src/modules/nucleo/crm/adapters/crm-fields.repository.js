import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: registro único de campos (`modulo_crm.crm_field` +
 * `crm_field_visibility`, migration 0012 — docs/crm/plano-configuracoes.md
 * M1). Único lugar que lê ou grava configuração de campo; o modelo antigo
 * (`tenant_lead_field_definitions`/`tenant_lead_field_visibility`) foi
 * removido na migration 0014. SQL cru via `$queryRaw`/`$executeRaw` tagged.
 *
 * @typedef {{
 *   id: string, system_key: string | null, chave: string, label: string,
 *   type: string, options: string[] | null, position: number,
 *   is_required: boolean, is_active: boolean, created_at: Date,
 *   visibilidade: Record<string, boolean>,
 * }} CrmFieldRow
 * @typedef {import('../types/index.js').FieldDefinition} FieldDefinition
 */

/**
 * Colunas de um personalizado no formato `FieldDefinition` da API. Texto
 * fixo deste arquivo (nunca do cliente) — único motivo pra `Prisma.raw`.
 */
const RETORNO_DEFINICAO_SQL = Prisma.raw(
  'id, chave, label, type AS tipo, options AS opcoes, is_required AS obrigatorio, position AS ordem, created_at',
);

/**
 * Prisma manda array JS como `text[]` — precisa virar JSON antes do
 * `::jsonb`. `null` vira SQL NULL de verdade, não o escalar JSON `null`.
 *
 * @param {string[] | null | undefined} opcoes
 */
const opcoesJson = (opcoes) => (opcoes === null || opcoes === undefined ? null : JSON.stringify(opcoes));

/**
 * Todos os campos do tenant (ativos e inativos), com a visibilidade por
 * contexto agregada num objeto `{ context: visible }`.
 *
 * @param {string} tenantId
 * @returns {Promise<CrmFieldRow[]>}
 */
export function buscarCamposDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT
        f.id, f.system_key, f.chave, f.label, f.type, f.options, f.position,
        f.is_required, f.is_active, f.created_at,
        COALESCE(
          (SELECT jsonb_object_agg(v.context, v.visible)
           FROM modulo_crm.crm_field_visibility v
           WHERE v.field_id = f.id AND v.tenant_id = f.tenant_id),
          '{}'::jsonb
        ) AS visibilidade
      FROM modulo_crm.crm_field f
      WHERE f.tenant_id = ${tenantId}::uuid
      ORDER BY f.position, f.created_at, f.id
    `,
  );
}

/**
 * Semeia os campos do sistema que ainda não existem pro tenant (`ON
 * CONFLICT DO NOTHING` no índice parcial de `system_key`) — rodar de novo
 * não muda nada. Só campo recém-criado ganha as linhas de visibilidade,
 * então a configuração que o tenant já fez nunca é sobrescrita.
 *
 * @param {string} tenantId
 * @param {{ systemKey: string, label: string, tipo: string, position: number, isRequired: boolean, visivel: boolean }[]} campos
 * @returns {Promise<number>} quantos campos foram criados
 */
export function inserirCamposSistema(tenantId, campos) {
  return getTenantClient(tenantId, async (tx) => {
    let criados = 0;
    for (const campo of campos) {
      const [linha] = await tx.$queryRaw`
        INSERT INTO modulo_crm.crm_field
          (tenant_id, system_key, chave, label, type, position, is_required)
        VALUES
          (${tenantId}::uuid, ${campo.systemKey}, ${campo.systemKey}, ${campo.label}, ${campo.tipo},
           ${campo.position}, ${campo.isRequired})
        ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (!linha) continue;

      criados += 1;
      await inserirVisibilidade(tx, tenantId, linha.id, campo.visivel);
    }
    return criados;
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} fieldId
 * @param {boolean} visivel  o mesmo valor nos quatro contextos
 */
function inserirVisibilidade(tx, tenantId, fieldId, visivel) {
  return tx.$executeRaw`
    INSERT INTO modulo_crm.crm_field_visibility (tenant_id, field_id, context, visible)
    SELECT ${tenantId}::uuid, ${fieldId}::uuid, contexto, ${visivel}
    FROM unnest(${LISTA_CONTEXTOS_VISIBILIDADE}::varchar[]) AS contexto
    ON CONFLICT (field_id, context) DO NOTHING
  `;
}

/**
 * Personalizado ATIVO com a chave — checagem de unicidade antes do
 * insert, pra erro amigável em vez do P2002 do índice parcial.
 *
 * @param {string} tenantId
 * @param {string} chave
 * @returns {Promise<{ id: string } | undefined>}
 */
export function buscarPersonalizadoAtivoPorChave(tenantId, chave) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id FROM modulo_crm.crm_field
      WHERE tenant_id = ${tenantId}::uuid AND chave = ${chave} AND system_key IS NULL AND is_active
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Personalizado novo, visível nos quatro contextos.
 *
 * @param {string} tenantId
 * @param {{ chave: string, label: string, tipo: string, opcoes: string[] | null, obrigatorio: boolean, ordem: number }} campo
 * @returns {Promise<FieldDefinition>}
 */
export function criarCampoPersonalizado(tenantId, { chave, label, tipo, opcoes, obrigatorio, ordem }) {
  return getTenantClient(tenantId, async (tx) => {
    const [criado] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_field
        (tenant_id, system_key, chave, label, type, options, position, is_required)
      VALUES
        (${tenantId}::uuid, NULL, ${chave}, ${label}, ${tipo}, ${opcoesJson(opcoes)}::jsonb, ${ordem}, ${obrigatorio})
      RETURNING ${RETORNO_DEFINICAO_SQL}
    `;
    await inserirVisibilidade(tx, tenantId, criado.id, true);
    return criado;
  });
}

/**
 * `chave` nunca muda — é o identificador estável que a API expõe e que
 * filtros salvos e mapeamentos de import referenciam.
 *
 * @param {string} tenantId
 * @param {string} fieldId
 * @param {{ label: string, tipo: string, opcoes: string[] | null, obrigatorio: boolean }} mudancas
 * @returns {Promise<FieldDefinition | undefined>}
 */
export function editarCampoPersonalizado(tenantId, fieldId, { label, tipo, opcoes, obrigatorio }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.crm_field
      SET label = ${label}, type = ${tipo}, options = ${opcoesJson(opcoes)}::jsonb,
          is_required = ${obrigatorio}, updated_at = now()
      WHERE id = ${fieldId}::uuid AND tenant_id = ${tenantId}::uuid AND system_key IS NULL AND is_active
      RETURNING ${RETORNO_DEFINICAO_SQL}
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Algum lead do tenant tem valor gravado pro campo (`custom_fields[id]`)?
 * Usa o índice GIN de `custom_fields` (operador `?`).
 *
 * @param {string} tenantId
 * @param {string} fieldId
 * @returns {Promise<boolean>}
 */
export function existeValorDoCampo(tenantId, fieldId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM modulo_crm.leads
        WHERE tenant_id = ${tenantId}::uuid AND custom_fields ? ${fieldId}
      ) AS existe
    `.then((rows) => Boolean(rows[FIRST_RESULT_INDEX]?.existe)),
  );
}

/**
 * "Excluir" personalizado = desativar: o `id` continua existindo e os
 * valores já gravados em `custom_fields[id]` seguem no lead (exclusão de
 * verdade/lixeira é M5). A chave fica livre pra um campo novo.
 *
 * @param {string} tenantId
 * @param {string} fieldId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function desativarCampoPersonalizado(tenantId, fieldId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.crm_field
      SET is_active = false, updated_at = now()
      WHERE id = ${fieldId}::uuid AND tenant_id = ${tenantId}::uuid AND system_key IS NULL AND is_active
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Área Configurações (M2): label, obrigatoriedade e visibilidade por
 * contexto de UM campo, numa transação. `label`/`isRequired` omitidos
 * (`undefined`) não mudam; `visibilidade` só grava os contextos enviados.
 *
 * @param {string} tenantId
 * @param {string} fieldId
 * @param {{ label?: string, isRequired?: boolean, visibilidade?: Record<string, boolean> }} mudancas
 */
export function atualizarCampoConfigurado(tenantId, fieldId, { label, isRequired, visibilidade = {} }) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_field
      SET label = COALESCE(${label ?? null}, label),
          is_required = COALESCE(${isRequired ?? null}::boolean, is_required),
          updated_at = now()
      WHERE id = ${fieldId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    for (const [contexto, visivel] of Object.entries(visibilidade)) {
      await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_field_visibility (tenant_id, field_id, context, visible)
        VALUES (${tenantId}::uuid, ${fieldId}::uuid, ${contexto}, ${visivel})
        ON CONFLICT (field_id, context) DO UPDATE SET visible = EXCLUDED.visible
      `;
    }
  });
}

/**
 * Nova ordem de todos os campos (sistema + personalizados): `position` =
 * índice na lista, num UPDATE só.
 *
 * @param {string} tenantId
 * @param {string[]} idsEmOrdem
 */
export function reordenarCampos(tenantId, idsEmOrdem) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.crm_field f
      SET position = nova.posicao - 1, updated_at = now()
      FROM unnest(${idsEmOrdem}::uuid[]) WITH ORDINALITY AS nova(id, posicao)
      WHERE f.id = nova.id AND f.tenant_id = ${tenantId}::uuid
    `,
  );
}
