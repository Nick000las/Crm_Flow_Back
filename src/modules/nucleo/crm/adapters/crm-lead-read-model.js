import { Prisma } from '@prisma/client';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

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
  if (schema.funil_legado && schema.status_legado) {
    return false;
  }
  if (schema.oportunidades && schema.principal_deal) {
    return true;
  }
  throw new AppError({
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.CRM_SCHEMA_INCOMPATIBLE,
    message: 'O schema do CRM está incompleto. Verifique as migrations do backend.',
  });
}

/**
 * As migrations de oportunidades moveram os campos comerciais do contato
 * para crm_deal. O contrato de leitura anterior representa a oportunidade
 * principal do lead; os dados continuam pertencendo à oportunidade.
 * Os dois modelos são suportados sem recriar tabelas ou alterar registros.
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
    SELECT contato.*, negocio.amount AS valor, negocio.status,
           etapa.id AS funil_estagio_id, etapa.label AS estagio_nome,
           etapa.position AS estagio_ordem,
           negocio.won_at AS data_conversao,
           negocio.probability_override AS probabilidade_fechamento,
           negocio.expected_close_date AS data_prevista_fechamento,
           negocio.lost_reason AS motivo_perda,
           negocio.pipeline_id
    FROM modulo_crm.leads contato
    LEFT JOIN modulo_crm.crm_deal negocio
      ON negocio.id = contato.principal_deal_id
      AND negocio.tenant_id = contato.tenant_id
      AND negocio.lead_id = contato.id AND negocio.deleted_at IS NULL
    LEFT JOIN modulo_crm.crm_option etapa
      ON etapa.tenant_id = negocio.tenant_id AND etapa.pipeline_id = negocio.pipeline_id
      AND etapa.kind = 'status' AND etapa.key = negocio.status
  )`;
}
