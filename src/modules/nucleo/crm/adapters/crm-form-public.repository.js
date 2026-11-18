/**
 * @file ADAPTER: leitura do link pela página pública (FM3), sem usuário logado.
 */
import { Prisma } from '@prisma/client';

import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { TENANT_STATUS } from '#shared/constants/index.js';

import { STATUS_LINK, TOLERANCIA_ENVIO_HORAS } from '../constants/formularios.js';

/**
 * ADAPTER: leitura do link pela página pública (FM3), sem usuário logado.
 *
 * O tenant sai do próprio link: o cliente admin procura **só** por
 * `token_hash` e devolve só o `tenant_id` (mesmo padrão de
 * `#core/tenant/feature-flags.js`). Todo o resto roda com
 * `getTenantClient`, sob RLS, no tenant do link.
 *
 * @typedef {{
 *   id: string, status: string, no_prazo: boolean, aberto_em: Date | null, expira_em: Date,
 *   formulario_id: string, formulario_nome: string, formulario_ativo: boolean,
 *   lead_id: string, oportunidade_id: string | null,
 *   versao_id: string, versao: number, secoes: object[], campos: Record<string, object>,
 *   introducao: string | null, termo: string, alertas: object[],
 *   pessoa: Record<string, any> | null,
 * }} LinkPublico
 */

/**
 * No prazo: antes de vencer, ou até `TOLERANCIA_ENVIO_HORAS` depois para
 * quem abriu antes de vencer (o link não fecha no meio do preenchimento).
 * Sobre `k` = crm_form_link.
 */
export const LINK_NO_PRAZO_SQL = Prisma.sql`(
  k.expires_at > CURRENT_TIMESTAMP
  OR (k.opened_at IS NOT NULL AND k.opened_at < k.expires_at
      AND CURRENT_TIMESTAMP < k.expires_at + make_interval(hours => ${TOLERANCIA_ENVIO_HORAS}::int))
)`;

/** Tenant que não abre página pública: suspenso ou cancelado. */
const STATUS_SEM_PAGINA = [TENANT_STATUS.SUSPENSO, TENANT_STATUS.CANCELADO];

/**
 * @param {Buffer} tokenHash
 * @returns {Promise<string | null>}
 */
export async function tenantDoToken(tokenHash) {
  const [linha] = await getAdminClient().$queryRaw`
    SELECT
      k.tenant_id::text AS tenant_id
    FROM
      modulo_crm.crm_form_link k
      JOIN tenants t ON t.id = k.tenant_id
    WHERE
      k.token_hash = ${tokenHash}
      AND t.status <> ALL (${STATUS_SEM_PAGINA}::TEXT[])
  `;

  return linha?.tenant_id ?? null;
}

/**
 * O link com a versão, o formulário e a pessoa. Pessoa na lixeira vem `null`.
 *
 * @param {string} tenantId
 * @param {Buffer} tokenHash
 * @returns {Promise<LinkPublico | undefined>}
 */
export function buscarLinkPublico(tenantId, tokenHash) {
  return getTenantClient(tenantId, async (tx) => {
    const [linha] = await tx.$queryRaw`
      SELECT
        k.id::text,
        k.status,
        ${LINK_NO_PRAZO_SQL} AS no_prazo,
        k.opened_at AS aberto_em,
        k.expires_at AS expira_em,
        f.name AS formulario_nome,
        f.is_active AS formulario_ativo,
        v.id::text AS versao_id,
        v.version AS versao,
        v.sections AS secoes,
        v.fields_snapshot AS campos,
        v.intro_text AS introducao,
        v.consent_text AS termo,
        v.alert_rules AS alertas,
        k.form_id::text AS formulario_id,
        k.lead_id::text AS lead_id,
        k.deal_id::text AS oportunidade_id,
        to_jsonb(l) AS pessoa
      FROM
        modulo_crm.crm_form_link k
        JOIN modulo_crm.crm_form f ON f.tenant_id = k.tenant_id
        AND f.id = k.form_id
        JOIN modulo_crm.crm_form_version v ON v.tenant_id = k.tenant_id
        AND v.id = k.form_version_id
        LEFT JOIN modulo_crm.leads l ON l.tenant_id = k.tenant_id
        AND l.id = k.lead_id
        AND l.deleted_at IS NULL
      WHERE
        k.tenant_id = ${tenantId}::uuid
        AND k.token_hash = ${tokenHash}
    `;

    return linha;
  });
}

/**
 * Marca a primeira abertura. Repetir não muda a data.
 *
 * @param {string} tenantId
 * @param {string} linkId
 * @returns {Promise<boolean>} se o link estava ativo e no prazo
 */
export function marcarLinkAberto(tenantId, linkId) {
  return getTenantClient(tenantId, async (tx) => {
    const [linha] = await tx.$queryRaw`
      UPDATE modulo_crm.crm_form_link
      SET
        opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP)
      WHERE
        tenant_id = ${tenantId}::uuid
        AND id = ${linkId}::uuid
        AND status = ${STATUS_LINK.ATIVO}
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING
        id
    `;

    return Boolean(linha);
  });
}
