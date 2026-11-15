import { getTenantClient } from '#core/db/tenantClient.js';
import {
  ENTIDADE_RESPOSTA_FORMULARIO,
  EVENTOS_FORMULARIO,
  STATUS_LINK,
} from '../constants/formularios.js';
import { TIPOS_EVENTO_LEAD } from '../constants/historico.js';
import { LINK_NO_PRAZO_SQL } from './crm-form-public.repository.js';
import { EVENTOS_PESSOA } from '../constants/oportunidades.js';
import { inserirAlertas } from './crm-form-alerts.repository.js';
import { inserirEvento } from './crm-lead-events.repository.js';
import { publicarEvento, publicarEventoDaPessoa } from './crm-outbox.repository.js';

/**
 * ADAPTER: respostas de formulário (`modulo_crm.crm_form_submission`,
 * migration 0045). Gravar a resposta, fechar o link, o evento do histórico e
 * o do outbox entram na mesma transação, com o link travado: o clique duplo
 * encontra o link já respondido e não grava de novo.
 *
 * @typedef {import('@prisma/client').Prisma.TransactionClient} Tx
 * @typedef {{
 *   id: string, formularioId: string, formularioNome: string, versaoId: string,
 *   linkId: string, leadId: string, oportunidadeId: string | null,
 *   respostas: { campos: Record<string, unknown>, perguntas: Record<string, unknown> },
 *   hashDoTermo: Buffer, preenchidoPor: string, nomeResponsavel: string | null,
 *   ip: string | null, userAgent: string | null, relatorio: object[],
 *   alertas: { regraId: string, nivel: string, texto: string, sensivel: boolean }[],
 * }} NovaResposta
 */

/**
 * Trava o link e diz se ainda aceita resposta: ativo e no prazo.
 *
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {string} linkId
 * @returns {Promise<boolean>}
 */
export async function travarLinkParaEnvio(tx, tenantId, linkId) {
  const [linha] = await tx.$queryRaw`
    SELECT k.status, ${LINK_NO_PRAZO_SQL} AS no_prazo
    FROM modulo_crm.crm_form_link k
    WHERE k.tenant_id = ${tenantId}::uuid AND k.id = ${linkId}::uuid
    FOR UPDATE
  `;
  return Boolean(linha && linha.status === STATUS_LINK.ATIVO && linha.no_prazo);
}

/**
 * Grava a resposta e fecha o link, com o histórico e o outbox. Só ids no
 * evento do outbox; o histórico leva também o nome do formulário.
 *
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {NovaResposta} resposta
 */
export async function gravarResposta(tx, tenantId, resposta) {
  await tx.$executeRaw`
    INSERT INTO modulo_crm.crm_form_submission
      (id, tenant_id, form_id, form_version_id, link_id, lead_id, deal_id, answers, consent_hash,
       consent_accepted_at, filled_by, guardian_name, ip, user_agent, write_report)
    VALUES (
      ${resposta.id}::uuid, ${tenantId}::uuid, ${resposta.formularioId}::uuid,
      ${resposta.versaoId}::uuid, ${resposta.linkId}::uuid, ${resposta.leadId}::uuid,
      ${resposta.oportunidadeId}::uuid, ${JSON.stringify(resposta.respostas)}::jsonb,
      ${resposta.hashDoTermo}, CURRENT_TIMESTAMP, ${resposta.preenchidoPor},
      ${resposta.nomeResponsavel}, ${resposta.ip}, ${resposta.userAgent},
      ${JSON.stringify(resposta.relatorio)}::jsonb
    )
  `;
  await tx.$executeRaw`
    UPDATE modulo_crm.crm_form_link
    SET status = ${STATUS_LINK.RESPONDIDO}, submitted_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${resposta.linkId}::uuid
  `;
  await inserirEvento(tx, tenantId, resposta.leadId, {
    tipo: TIPOS_EVENTO_LEAD.FORMULARIO_RESPONDIDO,
    autorId: null,
    diff: [],
    detalhes: {
      formularioId: resposta.formularioId,
      formularioNome: resposta.formularioNome,
      respostaId: resposta.id,
    },
  });
  await publicarEvento(tx, tenantId, {
    tipo: EVENTOS_FORMULARIO.RESPONDIDO,
    entidade: ENTIDADE_RESPOSTA_FORMULARIO,
    entidadeId: resposta.id,
    payload: { formularioId: resposta.formularioId, leadId: resposta.leadId },
  });
  if (resposta.alertas.length > 0) {
    await inserirAlertas(
      tx,
      tenantId,
      { leadId: resposta.leadId, respostaId: resposta.id, formularioId: resposta.formularioId },
      resposta.alertas,
    );
    // FM5: o card da pessoa ganha o selo de alerta pelo tempo real do quadro.
    await publicarEventoDaPessoa(tx, tenantId, resposta.leadId, EVENTOS_PESSOA.ATUALIZADA);
  }
}

/**
 * Resposta que não muda nenhum campo da pessoa. Trava a pessoa antes do link,
 * na mesma ordem da edição do lead, para dois envios não se travarem.
 *
 * @param {string} tenantId
 * @param {NovaResposta} resposta
 * @returns {Promise<boolean>} `false` se a pessoa ou o link não aceitam mais
 */
export function gravarRespostaSemEditarPessoa(tenantId, resposta) {
  return getTenantClient(tenantId, async (tx) => {
    const [pessoa] = await tx.$queryRaw`
      SELECT id FROM modulo_crm.leads
      WHERE tenant_id = ${tenantId}::uuid AND id = ${resposta.leadId}::uuid
        AND deleted_at IS NULL AND anonimizado_em IS NULL
      FOR UPDATE
    `;
    if (!pessoa || !(await travarLinkParaEnvio(tx, tenantId, resposta.linkId))) return false;
    await gravarResposta(tx, tenantId, resposta);
    return true;
  });
}

/**
 * @typedef {{
 *   id: string, formulario_id: string, formulario_nome: string, versao_id: string,
 *   versao: number, link_id: string, oportunidade_id: string | null, preenchido_por: string,
 *   nome_responsavel: string | null, respondido_em: Date, relatorio: object[],
 * }} RespostaResumo
 */

/**
 * Respostas da pessoa, da mais nova para a mais antiga, sem os valores.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<RespostaResumo[]>}
 */
export function buscarRespostasDaPessoa(tenantId, leadId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT r.id::text, r.form_id::text AS formulario_id, f.name AS formulario_nome,
        r.form_version_id::text AS versao_id, v.version AS versao, r.link_id::text AS link_id,
        r.deal_id::text AS oportunidade_id, r.filled_by AS preenchido_por,
        r.guardian_name AS nome_responsavel, r.submitted_at AS respondido_em,
        r.write_report AS relatorio
      FROM modulo_crm.crm_form_submission r
      JOIN modulo_crm.crm_form f ON f.tenant_id = r.tenant_id AND f.id = r.form_id
      JOIN modulo_crm.crm_form_version v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.lead_id = ${leadId}::uuid
      ORDER BY r.submitted_at DESC, r.id
    `,
  );
}

/**
 * Uma resposta com a versão que a pessoa viu.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} respostaId
 * @returns {Promise<(RespostaResumo & {
 *   respostas: { campos: Record<string, unknown>, perguntas: Record<string, unknown> },
 *   secoes: object[], campos: Record<string, any>, termo: string, aceito_em: Date,
 *   ip: string | null, user_agent: string | null,
 * }) | undefined>}
 */
export async function buscarResposta(tenantId, leadId, respostaId) {
  const [linha] = await getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT r.id::text, r.form_id::text AS formulario_id, f.name AS formulario_nome,
        r.form_version_id::text AS versao_id, v.version AS versao, r.link_id::text AS link_id,
        r.deal_id::text AS oportunidade_id, r.filled_by AS preenchido_por,
        r.guardian_name AS nome_responsavel, r.submitted_at AS respondido_em,
        r.write_report AS relatorio, r.answers AS respostas, v.sections AS secoes,
        v.fields_snapshot AS campos, v.consent_text AS termo, r.consent_accepted_at AS aceito_em,
        r.ip, r.user_agent
      FROM modulo_crm.crm_form_submission r
      JOIN modulo_crm.crm_form f ON f.tenant_id = r.tenant_id AND f.id = r.form_id
      JOIN modulo_crm.crm_form_version v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.lead_id = ${leadId}::uuid
        AND r.id = ${respostaId}::uuid
    `,
  );
  return linha;
}
