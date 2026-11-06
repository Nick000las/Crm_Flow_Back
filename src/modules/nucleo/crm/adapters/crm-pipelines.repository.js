import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: pipelines comerciais (`modulo_crm.crm_pipeline`, migration 0036).
 *
 * @typedef {{
 *   id: string, nome: string, tipo: string, position: number,
 *   padrao: boolean, ativo: boolean,
 * }} Pipeline
 */

const RETORNO_PIPELINE_SQL = Prisma.raw(
  'id::text, name AS nome, type AS tipo, position, is_default AS padrao, is_active AS ativo',
);

/**
 * O pipeline padrão (Vendas), como subconsulta. Até a oportunidade existir
 * (F4), o `status` do lead é sempre um status deste pipeline.
 *
 * @param {string} tenantId
 * @returns {Prisma.Sql}
 */
export function pipelinePadraoSql(tenantId) {
  return Prisma.sql`(
    SELECT p.id FROM modulo_crm.crm_pipeline p
    WHERE p.tenant_id = ${tenantId}::uuid AND p.is_default
  )`;
}

/**
 * @param {string} tenantId
 * @returns {Promise<Pipeline[]>} na ordem configurada
 */
export function buscarPipelines(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_PIPELINE_SQL} FROM modulo_crm.crm_pipeline
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY position, created_at, id
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {{ nome: string }} dados
 * @returns {Promise<void>}
 */
export function inserirPipelinePadrao(tenantId, { nome, tipo }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO modulo_crm.crm_pipeline (tenant_id, name, type, is_default)
      VALUES (${tenantId}::uuid, ${nome}, ${tipo}, true)
      ON CONFLICT (tenant_id) WHERE is_default DO NOTHING
    `,
  );
}

/**
 * Atendimento automático: nasce do pipeline padrão, ligado (decisão F-4).
 *
 * @param {string} tenantId
 * @param {{ nome: string, tipo: string, position: number, statusInicial: string, regraDoDono: string }} dados
 * @returns {Promise<Pipeline>}
 */
export function inserirPipelineDeAtendimento(tenantId, dados) {
  const { nome, tipo, position, statusInicial, regraDoDono } = dados;
  return getTenantClient(tenantId, async (tx) => {
    const [criado] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_pipeline (
        tenant_id, name, type, position, auto_create_enabled, auto_create_from_pipeline_id,
        auto_create_initial_status, auto_create_owner_rule
      )
      VALUES (
        ${tenantId}::uuid, ${nome}, ${tipo}, ${position}, true, ${pipelinePadraoSql(tenantId)},
        ${statusInicial}, ${regraDoDono}
      )
      RETURNING ${RETORNO_PIPELINE_SQL}
    `;
    return criado;
  });
}

/**
 * Cria respeitando o limite, sob lock por tenant: dois pedidos simultâneos não
 * passam juntos pela contagem.
 *
 * @param {string} tenantId
 * @param {{ nome: string, tipo: string }} dados
 * @param {number} limite
 * @returns {Promise<Pipeline | undefined>} `undefined` se o limite já foi atingido
 */
export function inserirPipelineDentroDoLimite(tenantId, { nome, tipo }, limite) {
  const chaveDoLock = `crm-pipelines:${tenantId}`;
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chaveDoLock}, 0))`;
    const [criado] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_pipeline (tenant_id, name, type, position)
      SELECT ${tenantId}::uuid, ${nome}, ${tipo}, total
      FROM (
        SELECT count(*)::int AS total FROM modulo_crm.crm_pipeline
        WHERE tenant_id = ${tenantId}::uuid
      ) atual
      WHERE total < ${limite}
      RETURNING ${RETORNO_PIPELINE_SQL}
    `;
    return criado;
  });
}
