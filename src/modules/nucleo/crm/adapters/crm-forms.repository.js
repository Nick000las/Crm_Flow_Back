import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: formulários e versões (`modulo_crm.crm_form` e
 * `crm_form_version`, migration 0043). A versão publicada é imutável
 * (trigger no banco); aqui só se insere.
 *
 * @typedef {{ secoes: object[], introducao: string | null, termo: string | null }} Rascunho
 * @typedef {{
 *   id: string, nome: string, descricao: string | null, ativo: boolean,
 *   validade_dias: number, rascunho: Rascunho, versao_atual_id: string | null,
 *   criado_em: Date, atualizado_em: Date,
 * }} FormularioLinha
 * @typedef {{
 *   id: string, formulario_id: string, versao: number, secoes: object[],
 *   campos: Record<string, object>, introducao: string | null, termo: string,
 *   publicada_em: Date, publicada_por: string | null,
 * }} VersaoLinha
 */

const RETORNO_FORMULARIO_SQL = Prisma.raw(
  `id::text, name AS nome, description AS descricao, is_active AS ativo,
   link_ttl_days AS validade_dias, draft AS rascunho, current_version_id::text AS versao_atual_id,
   created_at AS criado_em, updated_at AS atualizado_em`,
);

const RETORNO_VERSAO_SQL = Prisma.raw(
  `id::text, form_id::text AS formulario_id, version AS versao, sections AS secoes,
   fields_snapshot AS campos, intro_text AS introducao, consent_text AS termo,
   published_at AS publicada_em, published_by::text AS publicada_por`,
);

/**
 * @param {string} tenantId
 * @returns {Promise<FormularioLinha[]>} por nome
 */
export function buscarFormularios(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_FORMULARIO_SQL} FROM modulo_crm.crm_form
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY lower(name), id
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @returns {Promise<FormularioLinha | undefined>}
 */
export async function buscarFormulario(tenantId, id) {
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_FORMULARIO_SQL} FROM modulo_crm.crm_form
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    `,
  );
  return linha;
}

/**
 * Outro formulário com o mesmo nome, sem diferenciar maiúscula.
 *
 * @param {string} tenantId
 * @param {string} nome
 * @param {string | null} ignorarId
 * @returns {Promise<boolean>}
 */
export async function nomeEmUso(tenantId, nome, ignorarId) {
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT 1 FROM modulo_crm.crm_form
      WHERE tenant_id = ${tenantId}::uuid AND lower(name) = lower(${nome})
        AND (${ignorarId}::uuid IS NULL OR id <> ${ignorarId}::uuid)
    `,
  );
  return Boolean(linha);
}

/**
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
export async function contarFormularios(tenantId) {
  const [{ total }] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_crm.crm_form WHERE tenant_id = ${tenantId}::uuid
    `,
  );
  return total;
}

/**
 * @param {string} tenantId
 * @param {{ nome: string, descricao: string | null, validadeDias: number }} dados
 * @returns {Promise<FormularioLinha>}
 */
export async function inserirFormulario(tenantId, { nome, descricao, validadeDias }) {
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.crm_form (tenant_id, name, description, link_ttl_days)
      VALUES (${tenantId}::uuid, ${nome}, ${descricao}, ${validadeDias}::smallint)
      RETURNING ${RETORNO_FORMULARIO_SQL}
    `,
  );
  return linha;
}

/**
 * Só as chaves presentes mudam. `descricao: null` apaga a descrição.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ nome?: string, descricao?: string | null, validadeDias?: number, ativo?: boolean, rascunho?: Rascunho }} mudancas
 * @returns {Promise<FormularioLinha | undefined>}
 */
export async function atualizarFormulario(tenantId, id, mudancas) {
  const { nome, descricao, validadeDias, ativo, rascunho } = mudancas;
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.crm_form SET
        name = COALESCE(${nome ?? null}, name),
        description = CASE WHEN ${descricao !== undefined} THEN ${descricao ?? null} ELSE description END,
        link_ttl_days = COALESCE(${validadeDias ?? null}::smallint, link_ttl_days),
        is_active = COALESCE(${ativo ?? null}::boolean, is_active),
        draft = COALESCE(${rascunho === undefined ? null : JSON.stringify(rascunho)}::jsonb, draft)
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
      RETURNING ${RETORNO_FORMULARIO_SQL}
    `,
  );
  return linha;
}

/**
 * Publica a próxima versão e a torna a atual, numa transação. A linha do
 * formulário é travada: duas publicações simultâneas não pegam o mesmo
 * número.
 *
 * @param {string} tenantId
 * @param {string} formId
 * @param {{ secoes: object[], campos: Record<string, object>, introducao: string | null, termo: string, usuarioId: string | null }} versao
 * @returns {Promise<VersaoLinha | undefined>} `undefined` se o formulário não existe
 */
export function inserirVersao(tenantId, formId, { secoes, campos, introducao, termo, usuarioId }) {
  return getTenantClient(tenantId, async (tx) => {
    const [formulario] = await tx.$queryRaw`
      SELECT id FROM modulo_crm.crm_form
      WHERE tenant_id = ${tenantId}::uuid AND id = ${formId}::uuid
      FOR UPDATE
    `;
    if (!formulario) return undefined;

    const [versao] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_form_version
        (tenant_id, form_id, version, sections, fields_snapshot, intro_text, consent_text, published_by)
      SELECT ${tenantId}::uuid, ${formId}::uuid, COALESCE(max(version), 0) + 1,
        ${JSON.stringify(secoes)}::jsonb, ${JSON.stringify(campos)}::jsonb,
        ${introducao}, ${termo}, ${usuarioId}::uuid
      FROM modulo_crm.crm_form_version
      WHERE tenant_id = ${tenantId}::uuid AND form_id = ${formId}::uuid
      RETURNING ${RETORNO_VERSAO_SQL}
    `;
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_form SET current_version_id = ${versao.id}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND id = ${formId}::uuid
    `;
    return versao;
  });
}

/**
 * @param {string} tenantId
 * @param {string} formId
 * @returns {Promise<Omit<VersaoLinha, 'secoes' | 'campos'>[]>} da mais nova para a mais antiga
 */
export function buscarVersoes(tenantId, formId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id::text, version AS versao, published_at AS publicada_em, published_by::text AS publicada_por
      FROM modulo_crm.crm_form_version
      WHERE tenant_id = ${tenantId}::uuid AND form_id = ${formId}::uuid
      ORDER BY version DESC
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string} formId
 * @param {string} versaoId
 * @returns {Promise<VersaoLinha | undefined>}
 */
export async function buscarVersao(tenantId, formId, versaoId) {
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_VERSAO_SQL} FROM modulo_crm.crm_form_version
      WHERE tenant_id = ${tenantId}::uuid AND form_id = ${formId}::uuid AND id = ${versaoId}::uuid
    `,
  );
  return linha;
}
