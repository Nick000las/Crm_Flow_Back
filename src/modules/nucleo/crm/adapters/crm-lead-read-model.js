import { Prisma } from '@prisma/client';

/**
 * A leitura do lead: o contato com os campos comerciais da oportunidade
 * principal, nos nomes que a API sempre usou. Os dados pertencem à oportunidade.
 * Um lead sem principal devolve esses campos nulos: a leitura não escolhe uma
 * oportunidade arbitrária nem soma valores de negócios diferentes.
 *
 * O join não filtra `deleted_at`: a principal nunca é uma oportunidade excluída
 * sozinha, e um lead na lixeira leva as dele junto, sem perder os dados.
 * `pipeline_id` existe na leitura para resolver o status do pipeline certo.
 */
export const FONTE_LEADS = Prisma.sql`(
  SELECT contato.*,
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
