import { Prisma } from '@prisma/client';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

const COLUNAS_DO_CONTATO = Prisma.raw(
  [
    'id',
    'tenant_id',
    'nome',
    'primeiro_nome',
    'telefone',
    'email',
    'fonte_lead',
    'tags',
    'ultima_interacao_em',
    'empresa',
    'cargo',
    'cpf',
    'cnpj',
    'cidade',
    'uf',
    'cep',
    'endereco',
    'campanha_utm',
    'lead_score',
    'proximo_followup',
    'legal_basis',
    'legal_basis_at',
    'origem_registro',
    'marketing_opt_out_at',
    'anonimizado_em',
    'custom_fields',
    'usuario_responsavel_id',
    'assigned_by_rule_id',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
    'mesclado_em_id',
    'dedup_email',
    'dedup_telefone',
    'dedup_cnpj',
    'dedup_cpf',
    'lifecycle_stage',
    'lifecycle_changed_at',
    'principal_deal_id',
  ]
    .map((coluna) => `contato.${coluna}`)
    .join(', '),
);

export async function usaOportunidades(tx) {
  const [schema] = await tx.$queryRaw`
    SELECT to_regclass('modulo_crm.crm_deal') IS NOT NULL AS oportunidades,
           to_regclass('modulo_crm.funil_estagios') IS NOT NULL AS funil_legado,
           EXISTS (SELECT 1 FROM pg_attribute
                   WHERE attrelid = to_regclass('modulo_crm.leads')
                     AND attname = 'status' AND NOT attisdropped) AS status_legado,
           EXISTS (SELECT 1 FROM pg_attribute
                   WHERE attrelid = to_regclass('modulo_crm.leads')
                     AND attname = 'principal_deal_id' AND NOT attisdropped) AS principal_deal
  `;
  if (schema.oportunidades && schema.principal_deal) {
    return true;
  }
  if (schema.funil_legado && schema.status_legado) {
    return false;
  }
  throw new AppError({
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.CRM_SCHEMA_INCOMPATIBLE,
    message: 'O schema do CRM está incompleto. Verifique as migrations do backend.',
  });
}

/**
 * Os campos comerciais moram em crm_deal. O contrato de leitura do lead
 * representa a oportunidade principal; os dados continuam pertencendo a ela.
 *
 * O contato é listado coluna a coluna porque `leads` ainda tem as colunas
 * comerciais antigas, com os mesmos nomes: `contato.*` deixaria `l.status`
 * ambíguo. Na F5, quando elas saírem, volta a ser `contato.*`.
 *
 * O join não filtra `deleted_at`: a principal nunca é uma oportunidade excluída
 * sozinha, e um lead na lixeira leva as dele junto, sem perder os dados.
 * `pipeline_id` existe na leitura para resolver o status do pipeline certo.
 */
export async function fonteLeads(tx) {
  if (!(await usaOportunidades(tx))) {
    return Prisma.sql`(
      SELECT contato.*, etapa.nome AS estagio_nome, etapa."order" AS estagio_ordem
      FROM modulo_crm.leads contato
      LEFT JOIN modulo_crm.funil_estagios etapa
        ON etapa.id = contato.funil_estagio_id AND etapa.tenant_id = contato.tenant_id
    )`;
  }
  return Prisma.sql`(
    SELECT ${COLUNAS_DO_CONTATO},
           negocio.amount AS valor, negocio.status,
           etapa.id AS funil_estagio_id, etapa.label AS estagio_nome,
           negocio.won_at AS data_conversao,
           negocio.probability_override::numeric AS probabilidade_fechamento,
           negocio.expected_close_date::timestamp AS data_prevista_fechamento,
           negocio.lost_reason AS motivo_perda,
           negocio.pipeline_id
    FROM modulo_crm.leads contato
    LEFT JOIN modulo_crm.crm_deal negocio
      ON negocio.id = contato.principal_deal_id
      AND negocio.tenant_id = contato.tenant_id
      AND negocio.lead_id = contato.id
    LEFT JOIN modulo_crm.crm_option etapa
      ON etapa.tenant_id = negocio.tenant_id AND etapa.pipeline_id = negocio.pipeline_id
      AND etapa.kind = 'status' AND etapa.key = negocio.status
  )`;
}
