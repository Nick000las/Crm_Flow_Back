import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import {
  ENTIDADE_LINK_FORMULARIO,
  EVENTOS_FORMULARIO,
  STATUS_LINK,
} from '../constants/formularios.js';
import { publicarEvento } from './crm-outbox.repository.js';

/**
 * ADAPTER: links de formulário (`modulo_crm.crm_form_link`, migration 0044).
 * Criar, revogar e o evento no outbox entram na mesma transação.
 *
 * @typedef {{
 *   id: string, formulario_id: string, formulario_nome: string, versao_id: string,
 *   versao: number, oportunidade_id: string | null, status: string, expira_em: Date,
 *   aberto_em: Date | null, respondido_em: Date | null, revogado_em: Date | null,
 *   criado_em: Date, criado_por: string | null,
 * }} LinkLinha
 * @typedef {LinkLinha & { token_cifrado: Buffer }} LinkComToken
 */

const STATUS_DERIVADO_SQL = Prisma.sql`
  CASE WHEN k.status = ${STATUS_LINK.ATIVO} AND k.expires_at < CURRENT_TIMESTAMP
    THEN ${STATUS_LINK.EXPIRADO} ELSE k.status END`;

const RETORNO_LINK_SQL = Prisma.sql`
  k.id::text, k.form_id::text AS formulario_id, f.name AS formulario_nome,
  k.form_version_id::text AS versao_id, v.version AS versao, k.deal_id::text AS oportunidade_id,
  ${STATUS_DERIVADO_SQL} AS status, k.expires_at AS expira_em, k.opened_at AS aberto_em,
  k.submitted_at AS respondido_em, k.revoked_at AS revogado_em, k.created_at AS criado_em,
  k.created_by::text AS criado_por`;

const JUNCOES_SQL = Prisma.sql`
  JOIN modulo_crm.crm_form f ON f.tenant_id = k.tenant_id AND f.id = k.form_id
  JOIN modulo_crm.crm_form_version v ON v.tenant_id = k.tenant_id AND v.id = k.form_version_id`;

/**
 * Por que o link não pode ser criado, ou `null`.
 *
 * @typedef {'pessoa' | 'anonimizada' | 'arquivada' | 'formulario' | 'oportunidade' | null} Impedimento
 */

/**
 * Devolve o link ativo da pessoa naquele formulário ou cria um, numa
 * transação. Um ativo vencido vira `expired` antes, e o índice único parcial
 * resolve dois pedidos ao mesmo tempo: o segundo reaproveita o do primeiro.
 *
 * @param {string} tenantId
 * @param {{
 *   leadId: string, formId: string, dealId: string | null, usuarioId: string | null,
 *   tokenHash: Buffer, tokenCifrado: Buffer,
 * }} dados
 * @returns {Promise<{ impedimento: Impedimento, link?: LinkComToken, criado?: boolean }>}
 */
export function criarOuReaproveitarLink(tenantId, dados) {
  const { leadId, formId, dealId, usuarioId, tokenHash, tokenCifrado } = dados;
  return getTenantClient(tenantId, async (tx) => {
    const [pessoa] = await tx.$queryRaw`
      SELECT anonimizado_em, archived_at FROM modulo_crm.leads
      WHERE tenant_id = ${tenantId}::uuid AND id = ${leadId}::uuid AND deleted_at IS NULL
      FOR SHARE
    `;
    if (!pessoa) return { impedimento: 'pessoa' };
    if (pessoa.anonimizado_em) return { impedimento: 'anonimizada' };
    if (pessoa.archived_at) return { impedimento: 'arquivada' };

    const [formulario] = await tx.$queryRaw`
      SELECT current_version_id::text AS versao_id, link_ttl_days AS validade
      FROM modulo_crm.crm_form
      WHERE tenant_id = ${tenantId}::uuid AND id = ${formId}::uuid
        AND is_active AND current_version_id IS NOT NULL
    `;
    if (!formulario) return { impedimento: 'formulario' };

    if (dealId) {
      const [deal] = await tx.$queryRaw`
        SELECT 1 FROM modulo_crm.crm_deal
        WHERE tenant_id = ${tenantId}::uuid AND id = ${dealId}::uuid
          AND lead_id = ${leadId}::uuid AND deleted_at IS NULL
      `;
      if (!deal) return { impedimento: 'oportunidade' };
    }

    await tx.$executeRaw`
      UPDATE modulo_crm.crm_form_link SET status = ${STATUS_LINK.EXPIRADO}
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
        AND form_id = ${formId}::uuid AND status = ${STATUS_LINK.ATIVO}
        AND expires_at < CURRENT_TIMESTAMP
    `;
    const [novo] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_form_link
        (tenant_id, form_id, form_version_id, lead_id, deal_id, token_hash, token_encrypted,
         expires_at, created_by)
      VALUES (
        ${tenantId}::uuid, ${formId}::uuid, ${formulario.versao_id}::uuid, ${leadId}::uuid,
        ${dealId}::uuid, ${tokenHash}, ${tokenCifrado},
        CURRENT_TIMESTAMP + make_interval(days => ${formulario.validade}::int), ${usuarioId}::uuid
      )
      ON CONFLICT (tenant_id, lead_id, form_id) WHERE status = 'active' DO NOTHING
      RETURNING id::text
    `;
    if (novo) {
      await publicarEvento(tx, tenantId, {
        tipo: EVENTOS_FORMULARIO.LINK_CRIADO,
        entidade: ENTIDADE_LINK_FORMULARIO,
        entidadeId: novo.id,
        payload: { formularioId: formId, leadId },
      });
    }
    const [link] = await tx.$queryRaw`
      SELECT ${RETORNO_LINK_SQL}, k.token_encrypted AS token_cifrado
      FROM modulo_crm.crm_form_link k ${JUNCOES_SQL}
      WHERE k.tenant_id = ${tenantId}::uuid AND k.lead_id = ${leadId}::uuid
        AND k.form_id = ${formId}::uuid AND k.status = ${STATUS_LINK.ATIVO}
    `;
    return { impedimento: null, link, criado: Boolean(novo) };
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<LinkLinha[]>} do mais novo para o mais antigo
 */
export function buscarLinksDaPessoa(tenantId, leadId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_LINK_SQL}
      FROM modulo_crm.crm_form_link k ${JUNCOES_SQL}
      WHERE k.tenant_id = ${tenantId}::uuid AND k.lead_id = ${leadId}::uuid
      ORDER BY k.created_at DESC, k.id
    `,
  );
}

/**
 * Revoga o link ativo, mesmo vencido. Outro estado: `undefined`.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} linkId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function revogarLinkAtivo(tenantId, leadId, linkId) {
  return getTenantClient(tenantId, async (tx) => {
    const [revogado] = await tx.$queryRaw`
      UPDATE modulo_crm.crm_form_link
      SET status = ${STATUS_LINK.REVOGADO}, revoked_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
        AND id = ${linkId}::uuid AND status = ${STATUS_LINK.ATIVO}
      RETURNING id::text, form_id::text AS formulario_id
    `;
    if (revogado) {
      await publicarEvento(tx, tenantId, {
        tipo: EVENTOS_FORMULARIO.LINK_REVOGADO,
        entidade: ENTIDADE_LINK_FORMULARIO,
        entidadeId: revogado.id,
        payload: { formularioId: revogado.formulario_id, leadId },
      });
    }
    return revogado;
  });
}

/**
 * Formulários que a ficha pode enviar: ativos e publicados.
 *
 * @param {string} tenantId
 * @returns {Promise<{ id: string, nome: string, descricao: string | null, validade_dias: number, versao: number }[]>}
 */
export function buscarFormulariosDisponiveis(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT f.id::text, f.name AS nome, f.description AS descricao,
        f.link_ttl_days AS validade_dias, v.version AS versao
      FROM modulo_crm.crm_form f
      JOIN modulo_crm.crm_form_version v ON v.tenant_id = f.tenant_id AND v.id = f.current_version_id
      WHERE f.tenant_id = ${tenantId}::uuid AND f.is_active
      ORDER BY lower(f.name), f.id
    `,
  );
}
