/**
 * @file ADAPTER: formulários no ciclo de vida da pessoa (FM6). Tudo aqui recebe a transação de
 * quem chama (arquivar, lixeira, mesclar, anonimizar), com a pessoa já travada: os formulários
 * mudam junto com ela ou nada muda.
 */
import {
  ENTIDADE_LINK_FORMULARIO,
  EVENTOS_FORMULARIO,
  GUC_FORM_MESCLANDO,
  RESPOSTA_ANONIMIZADA,
  STATUS_LINK,
} from '../constants/formularios.js';
import { publicarEvento } from './crm-outbox.repository.js';

/**
 * ADAPTER: formulários no ciclo de vida da pessoa (FM6). Tudo aqui recebe a
 * transação de quem chama (arquivar, lixeira, mesclar, anonimizar), com a
 * pessoa já travada: os formulários mudam junto com ela ou nada muda.
 *
 * @typedef {import('@prisma/client').Prisma.TransactionClient} Tx
 */

/**
 * Revoga os links ativos das pessoas, com `form.link_revoked` (só ids).
 *
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {string[]} leadIds
 * @returns {Promise<number>} quantos foram revogados
 */
export async function revogarLinksAtivosDasPessoas(tx, tenantId, leadIds) {
  const revogados = await tx.$queryRaw`
    UPDATE modulo_crm.crm_form_link
    SET
      status = ${STATUS_LINK.REVOGADO},
      revoked_at = CURRENT_TIMESTAMP
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ANY (${leadIds}::UUID[])
      AND status = ${STATUS_LINK.ATIVO}
    RETURNING
      id::text,
      form_id::text AS formulario_id,
      lead_id::text
  `;

  for (const link of revogados) {
    await publicarEvento(tx, tenantId, {
      tipo: EVENTOS_FORMULARIO.LINK_REVOGADO,
      entidade: ENTIDADE_LINK_FORMULARIO,
      entidadeId: link.id,
      payload: { formularioId: link.formulario_id, leadId: link.lead_id },
    });
  }

  return revogados.length;
}

/**
 * Mesclagem: links, respostas e alertas do descartado passam para o principal.
 * Se os dois têm link ativo do mesmo formulário, fica o mais recente e o
 * outro é revogado (a pessoa tem um ativo por formulário).
 *
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {{ principalId: string, secundarioId: string }} ids
 */
export async function moverFormulariosNaMesclagem(tx, tenantId, { principalId, secundarioId }) {
  const duplicados = await tx.$queryRaw`
    UPDATE modulo_crm.crm_form_link k
    SET
      status = ${STATUS_LINK.REVOGADO},
      revoked_at = CURRENT_TIMESTAMP
    WHERE
      k.tenant_id = ${tenantId}::uuid
      AND k.lead_id IN (${principalId}::uuid, ${secundarioId}::uuid)
      AND k.status = ${STATUS_LINK.ATIVO}
      AND EXISTS (
        SELECT
          1
        FROM
          modulo_crm.crm_form_link outro
        WHERE
          outro.tenant_id = k.tenant_id
          AND outro.form_id = k.form_id
          AND outro.status = ${STATUS_LINK.ATIVO}
          AND outro.id <> k.id
          AND outro.lead_id IN (${principalId}::uuid, ${secundarioId}::uuid)
          AND (outro.created_at, outro.id) > (k.created_at, k.id)
      )
    RETURNING
      k.id::text,
      k.form_id::text AS formulario_id
  `;

  for (const link of duplicados) {
    await publicarEvento(tx, tenantId, {
      tipo: EVENTOS_FORMULARIO.LINK_REVOGADO,
      entidade: ENTIDADE_LINK_FORMULARIO,
      entidadeId: link.id,
      payload: { formularioId: link.formulario_id, leadId: principalId },
    });
  }

  await tx.$executeRaw`
    UPDATE modulo_crm.crm_form_link
    SET
      lead_id = ${principalId}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ${secundarioId}::uuid
  `;

  // A resposta é imutável: só a troca de pessoa passa, com o GUC desta transação.
  await tx.$queryRaw`
    SELECT
      set_config(${GUC_FORM_MESCLANDO}, 'on', TRUE)
  `;

  await tx.$executeRaw`
    UPDATE modulo_crm.crm_form_submission
    SET
      lead_id = ${principalId}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ${secundarioId}::uuid
  `;

  await tx.$queryRaw`
    SELECT
      set_config(${GUC_FORM_MESCLANDO}, 'off', TRUE)
  `;

  await tx.$executeRaw`
    UPDATE modulo_crm.crm_form_alert
    SET
      lead_id = ${principalId}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ${secundarioId}::uuid
  `;
}

/**
 * Anonimização: revoga os links ativos, apaga os valores das respostas (todas
 * as perguntas e todos os campos), o nome do responsável, o IP e o navegador,
 * e apaga os alertas. Ficam formulário, versão, datas, aceite e o relatório
 * de escrita, que não tem valores. Espera o GUC da anonimização ligado pela
 * transação de quem chama (`crm-lgpd.repository.js`).
 *
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {string[]} leadIds  a pessoa e os que foram mesclados nela
 * @returns {Promise<{ links: number, respostas: number, alertas: number }>}
 */
export async function anonimizarFormulariosDasPessoas(tx, tenantId, leadIds) {
  const links = await revogarLinksAtivosDasPessoas(tx, tenantId, leadIds);
  const respostas = await tx.$executeRaw`
    UPDATE modulo_crm.crm_form_submission
    SET
      answers = ${JSON.stringify(RESPOSTA_ANONIMIZADA.RESPOSTAS)}::jsonb,
      guardian_name = CASE
        WHEN guardian_name IS NULL THEN NULL
        ELSE ${RESPOSTA_ANONIMIZADA.RESPONSAVEL}
      END,
      ip = NULL,
      user_agent = NULL
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ANY (${leadIds}::UUID[])
  `;
  const alertas = await tx.$executeRaw`
    DELETE FROM modulo_crm.crm_form_alert
    WHERE
      tenant_id = ${tenantId}::uuid
      AND lead_id = ANY (${leadIds}::UUID[])
  `;

  return { links, respostas, alertas };
}
