/**
 * @file A pessoa aparece se tiver ao menos uma oportunidade visível, ou nenhuma (D4). Na
 * lixeira, olha as que foram junto com ela.
 */
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
 *
 * @param {Prisma.Sql} [visibilidade]  condição extra sobre `negocio`
 * @returns {Prisma.Sql}
 */
function leituraDoLead(visibilidade = Prisma.empty) {
  return Prisma.sql`(
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
      AND negocio.lead_id = contato.id ${visibilidade}
    LEFT JOIN modulo_crm.crm_option etapa
      ON etapa.tenant_id = negocio.tenant_id AND etapa.pipeline_id = negocio.pipeline_id
      AND etapa.kind = 'status' AND etapa.key = negocio.status
  )`;
}

export const FONTE_LEADS = leituraDoLead();

/**
 * A mesma leitura para quem não vê alguns pipelines (D4): principal oculta sai
 * com os campos comerciais nulos já aqui, então leitura, filtro e total não têm
 * como revelá-la.
 *
 * @param {string[]} [ocultos]  ids dos pipelines
 * @returns {Prisma.Sql}
 */
export function fonteLeadsVisivel(ocultos = []) {
  if (ocultos.length === 0) {
    return FONTE_LEADS;
  }

  return leituraDoLead(Prisma.sql`AND negocio.pipeline_id <> ALL(${ocultos}::uuid[])`);
}

/**
 * A pessoa aparece se tiver ao menos uma oportunidade visível, ou nenhuma (D4).
 * Na lixeira, olha as que foram junto com ela.
 *
 * @param {string[]} ocultos  não vazio
 * @returns {Prisma.Sql}  espera `l` com `tenant_id`, `id` e `deleted_at` do lead
 */
export function condicaoPessoaVisivel(ocultos) {
  const daPessoa = Prisma.sql`
    d.tenant_id = l.tenant_id AND d.lead_id = l.id
    AND (d.deleted_at IS NULL OR l.deleted_at IS NOT NULL)
  `;

  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM modulo_crm.crm_deal d
      WHERE ${daPessoa} AND d.pipeline_id <> ALL(${ocultos}::uuid[])
    )
    OR NOT EXISTS (SELECT 1 FROM modulo_crm.crm_deal d WHERE ${daPessoa})
  )`;
}
