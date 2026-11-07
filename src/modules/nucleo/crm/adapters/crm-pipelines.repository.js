import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: pipelines comerciais (`modulo_crm.crm_pipeline`, migration 0036).
 *
 * @typedef {{
 *   id: string, nome: string, tipo: string, position: number,
 *   padrao: boolean, ativo: boolean, automacao_ativa: boolean,
 *   automacao_origem_id: string | null, automacao_status_inicial: string | null,
 *   automacao_regra_dono: string, automacao_dono_id: string | null, visivel_operador: boolean,
 * }} Pipeline
 */

const RETORNO_PIPELINE_SQL = Prisma.raw(
  `id::text, name AS nome, type AS tipo, position, is_default AS padrao, is_active AS ativo,
   auto_create_enabled AS automacao_ativa, auto_create_from_pipeline_id::text AS automacao_origem_id,
   auto_create_initial_status AS automacao_status_inicial,
   auto_create_owner_rule AS automacao_regra_dono, auto_create_owner_id::text AS automacao_dono_id,
   operator_visible AS visivel_operador`,
);

/**
 * O pipeline padrão (Vendas), como subconsulta: onde nasce a oportunidade de
 * todo lead novo, e de onde saem as opções de status de `/crm/leads`.
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
 * @param {readonly { key: string, label: string, color: string, category: string }[]} status
 *   lista inicial, na mesma transação: pipeline sem status não funciona
 * @returns {Promise<Pipeline | undefined>} `undefined` se o limite já foi atingido
 */
export function inserirPipelineDentroDoLimite(tenantId, { nome, tipo }, limite, status) {
  return getTenantClient(tenantId, async (tx) => {
    await travarPipelines(tx, tenantId);
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
    if (!criado) return undefined;
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_option (tenant_id, kind, pipeline_id, key, label, color, category, position)
      SELECT ${tenantId}::uuid, 'status', ${criado.id}::uuid, o.key, o.label, o.color, o.category,
             o.posicao - 1
      FROM unnest(
        ${status.map((opcao) => opcao.key)}::varchar[],
        ${status.map((opcao) => opcao.label)}::varchar[],
        ${status.map((opcao) => opcao.color)}::varchar[],
        ${status.map((opcao) => opcao.category)}::varchar[]
      ) WITH ORDINALITY AS o(key, label, color, category, posicao)
    `;
    return criado;
  });
}

/** Criar e excluir disputam a contagem: um pedido por tenant de cada vez. */
function travarPipelines(tx, tenantId) {
  const chaveDoLock = `crm-pipelines:${tenantId}`;
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chaveDoLock}, 0))`;
}

/**
 * @param {string} tenantId
 * @returns {Promise<string[]>} ids dos pipelines ocultos para o OPERADOR (D4)
 */
export async function buscarPipelinesOcultos(tenantId) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id::text FROM modulo_crm.crm_pipeline
      WHERE tenant_id = ${tenantId}::uuid AND NOT operator_visible
    `,
  );
  return linhas.map((linha) => linha.id);
}

/**
 * Oportunidades por pipeline, inclusive as arquivadas e as da lixeira.
 *
 * @param {string} tenantId
 * @returns {Promise<Map<string, number>>}
 */
export async function contarOportunidadesPorPipeline(tenantId) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT pipeline_id::text, count(*)::int AS total FROM modulo_crm.crm_deal
      WHERE tenant_id = ${tenantId}::uuid
      GROUP BY pipeline_id
    `,
  );
  return new Map(linhas.map((linha) => [linha.pipeline_id, linha.total]));
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {{
 *   nome: string, ativo: boolean, visivelOperador: boolean, automacaoAtiva: boolean, origemId: string | null,
 *   statusInicial: string | null, regraDoDono: string, donoId: string | null,
 * }} dados  o estado final, já validado pelo service
 * @returns {Promise<Pipeline | undefined>}
 */
export function salvarPipeline(tenantId, id, dados) {
  return getTenantClient(tenantId, async (tx) => {
    const [salvo] = await tx.$queryRaw`
      UPDATE modulo_crm.crm_pipeline
      SET name = ${dados.nome}, is_active = ${dados.ativo},
          operator_visible = ${dados.visivelOperador},
          auto_create_enabled = ${dados.automacaoAtiva},
          auto_create_from_pipeline_id = ${dados.origemId}::uuid,
          auto_create_initial_status = ${dados.statusInicial},
          auto_create_owner_rule = ${dados.regraDoDono},
          auto_create_owner_id = ${dados.donoId}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
      RETURNING ${RETORNO_PIPELINE_SQL}
    `;
    return salvo;
  });
}

/**
 * Apaga o pipeline e os status dele. Nunca o padrão, nem com oportunidade,
 * nem se outro pipeline nasce dele. A conferência é feita aqui, sob o lock.
 *
 * @param {string} tenantId
 * @param {string} id
 * @returns {Promise<'removido' | 'nao_encontrado' | 'padrao' | 'em_uso' | 'origem'>}
 */
export function excluirPipeline(tenantId, id) {
  return getTenantClient(tenantId, async (tx) => {
    await travarPipelines(tx, tenantId);
    const [alvo] = await tx.$queryRaw`
      SELECT is_default AS padrao,
        EXISTS (
          SELECT 1 FROM modulo_crm.crm_deal d
          WHERE d.tenant_id = p.tenant_id AND d.pipeline_id = p.id
        ) AS em_uso,
        EXISTS (
          SELECT 1 FROM modulo_crm.crm_pipeline o
          WHERE o.tenant_id = p.tenant_id AND o.auto_create_from_pipeline_id = p.id
        ) AS origem
      FROM modulo_crm.crm_pipeline p
      WHERE p.tenant_id = ${tenantId}::uuid AND p.id = ${id}::uuid
      FOR UPDATE
    `;
    if (!alvo) return 'nao_encontrado';
    if (alvo.padrao) return 'padrao';
    if (alvo.em_uso) return 'em_uso';
    if (alvo.origem) return 'origem';
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid AND pipeline_id = ${id}::uuid
    `;
    await tx.$executeRaw`
      DELETE FROM modulo_crm.crm_pipeline
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    `;
    return 'removido';
  });
}
