import { getTenantClient } from '#core/db/tenantClient.js';
import { LISTA_NIVEIS_ALERTA } from '../constants/formularios.js';

/**
 * ADAPTER: alertas de formulário (`crm_form_alert` e `crm_form_alert_seen`,
 * migration 0046). O alerta nasce na transação da resposta; "visto" é por
 * usuário.
 *
 * @typedef {import('@prisma/client').Prisma.TransactionClient} Tx
 * @typedef {{
 *   id: string, lead_id: string, resposta_id: string, formulario_id: string,
 *   formulario_nome: string, regra_id: string, nivel: string, texto: string,
 *   sensivel: boolean, criado_em: Date, visto_em: Date | null,
 *   regras: { id: string, alvo: { campoId?: string, perguntaId?: string } }[],
 *   campos: Record<string, { sensivel?: boolean }>,
 * }} AlertaLinha
 */

/**
 * @param {Tx} tx
 * @param {string} tenantId
 * @param {{ leadId: string, respostaId: string, formularioId: string }} origem
 * @param {{ regraId: string, nivel: string, texto: string, sensivel: boolean }[]} alertas
 */
export async function inserirAlertas(tx, tenantId, origem, alertas) {
  for (const alerta of alertas) {
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_form_alert
        (tenant_id, lead_id, submission_id, form_id, rule_id, level, text, sensitive)
      VALUES (
        ${tenantId}::uuid, ${origem.leadId}::uuid, ${origem.respostaId}::uuid,
        ${origem.formularioId}::uuid, ${alerta.regraId}, ${alerta.nivel}, ${alerta.texto},
        ${alerta.sensivel}
      )
    `;
  }
}

/**
 * Alertas da pessoa, os mais graves e mais novos primeiro. Sem `todos`, só os
 * que este usuário ainda não viu. Traz as regras e o retrato da versão para o
 * service saber o alvo de cada um.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} usuarioId
 * @param {{ todos?: boolean }} [opcoes]
 * @returns {Promise<AlertaLinha[]>}
 */
export function buscarAlertasDaPessoa(tenantId, leadId, usuarioId, { todos = false } = {}) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT a.id::text, a.lead_id::text, a.submission_id::text AS resposta_id,
        a.form_id::text AS formulario_id, f.name AS formulario_nome, a.rule_id AS regra_id,
        a.level AS nivel, a.text AS texto, a.sensitive AS sensivel, a.created_at AS criado_em,
        s.seen_at AS visto_em, v.alert_rules AS regras, v.fields_snapshot AS campos
      FROM modulo_crm.crm_form_alert a
      JOIN modulo_crm.crm_form f ON f.tenant_id = a.tenant_id AND f.id = a.form_id
      JOIN modulo_crm.crm_form_submission r ON r.tenant_id = a.tenant_id AND r.id = a.submission_id
      JOIN modulo_crm.crm_form_version v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      LEFT JOIN modulo_crm.crm_form_alert_seen s
        ON s.tenant_id = a.tenant_id AND s.alert_id = a.id AND s.user_id = ${usuarioId}::uuid
      WHERE a.tenant_id = ${tenantId}::uuid AND a.lead_id = ${leadId}::uuid
        AND (${todos} OR s.alert_id IS NULL)
      ORDER BY array_position(${[...LISTA_NIVEIS_ALERTA]}::text[], a.level) DESC,
        a.created_at DESC, a.id
    `,
  );
}

/**
 * Marca o alerta da pessoa como visto por este usuário. Repetir não muda a data.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} alertaId
 * @param {string} usuarioId
 * @returns {Promise<boolean>} `false` se o alerta não é desta pessoa
 */
export function marcarAlertaVisto(tenantId, leadId, alertaId, usuarioId) {
  return getTenantClient(tenantId, async (tx) => {
    const [alerta] = await tx.$queryRaw`
      SELECT id FROM modulo_crm.crm_form_alert
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid AND id = ${alertaId}::uuid
    `;
    if (!alerta) return false;
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_form_alert_seen (tenant_id, alert_id, user_id)
      VALUES (${tenantId}::uuid, ${alertaId}::uuid, ${usuarioId}::uuid)
      ON CONFLICT (alert_id, user_id) DO NOTHING
    `;
    return true;
  });
}

/**
 * Nível mais grave dos alertas que este usuário não viu, por pessoa (selo do
 * card do quadro). Pessoa sem alerta pendente não aparece.
 *
 * @param {string} tenantId
 * @param {string[]} leadIds
 * @param {string} usuarioId
 * @returns {Promise<{ lead_id: string, nivel: string }[]>}
 */
export function buscarNivelPendentePorPessoa(tenantId, leadIds, usuarioId) {
  if (leadIds.length === 0) return Promise.resolve([]);
  const niveis = [...LISTA_NIVEIS_ALERTA];
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT a.lead_id::text,
        (${niveis}::text[])[max(array_position(${niveis}::text[], a.level))] AS nivel
      FROM modulo_crm.crm_form_alert a
      WHERE a.tenant_id = ${tenantId}::uuid AND a.lead_id = ANY(${leadIds}::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM modulo_crm.crm_form_alert_seen s
          WHERE s.tenant_id = a.tenant_id AND s.alert_id = a.id AND s.user_id = ${usuarioId}::uuid
        )
      GROUP BY a.lead_id
    `,
  );
}
