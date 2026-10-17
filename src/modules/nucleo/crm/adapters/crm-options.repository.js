import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { COLUNA_DA_LISTA, TIPOS_LISTA } from '../constants.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: listas configuráveis (`modulo_crm.crm_option`, migration 0016 —
 * docs/crm/plano-configuracoes.md M3). Único lugar que lê ou grava opção de
 * lista. SQL cru via `$queryRaw`/`$executeRaw` tagged.
 *
 * @typedef {{
 *   id: string, kind: string, key: string, label: string, color: string | null,
 *   position: number, category: string | null, ativo: boolean,
 * }} OpcaoLista
 */

/** Colunas no formato da API. Texto fixo deste arquivo — único motivo pra `Prisma.raw`. */
const RETORNO_OPCAO_SQL = Prisma.raw('id, kind, key, label, color, position, category, is_active AS ativo');

/**
 * Coluna do lead de uma lista com valor escalar. Só sai do mapa fechado
 * `COLUNA_DA_LISTA` — o texto do cliente nunca vira identificador SQL.
 *
 * @param {string} kind
 */
function colunaDoLead(kind) {
  const coluna = COLUNA_DA_LISTA[kind];
  if (!coluna) throw new Error(`Lista sem coluna no lead: ${kind}`);
  return Prisma.raw(`l.${coluna}`);
}

/**
 * Todas as opções do tenant (ativas e inativas), na ordem configurada.
 *
 * @param {string} tenantId
 * @returns {Promise<OpcaoLista[]>}
 */
export function buscarOpcoesDoTenant(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${RETORNO_OPCAO_SQL}
      FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY kind, position, created_at, id
    `,
  );
}

/**
 * O tenant já tem algum lead? Decide o padrão semeado: tenant com lead
 * recebe as keys antigas (que os leads já usam); sem lead, as sugeridas.
 *
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
export function tenantTemLeads(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT EXISTS (SELECT 1 FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid) AS existe
    `.then((rows) => Boolean(rows[FIRST_RESULT_INDEX]?.existe)),
  );
}

/**
 * Tags já gravadas nos leads (texto exato) — o reconcile as transforma em
 * opções com a MESMA key, pra nenhum lead mudar.
 *
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
export function buscarTagsDosLeads(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT DISTINCT tag
      FROM modulo_crm.leads l, unnest(l.tags) AS tag
      WHERE l.tenant_id = ${tenantId}::uuid AND tag IS NOT NULL AND tag <> ''
      ORDER BY tag
    `.then((rows) => rows.map((row) => row.tag)),
  );
}

/**
 * Insere as opções que ainda não existem (`ON CONFLICT DO NOTHING` em
 * `(tenant_id, kind, key)`) — rodar de novo não muda nada, e opção que o
 * tenant já editou nunca é sobrescrita.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @param {{ key: string, label: string, color?: string | null, category?: string | null, position: number }[]} opcoes
 * @returns {Promise<OpcaoLista[]>} só as criadas agora
 */
export function inserirOpcoes(tenantId, kind, opcoes) {
  if (opcoes.length === 0) return Promise.resolve([]);
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.crm_option (tenant_id, kind, key, label, color, category, position)
      SELECT ${tenantId}::uuid, ${kind}, o.key, o.label, o.color, o.category, o.position
      FROM unnest(
        ${opcoes.map((opcao) => opcao.key)}::varchar[],
        ${opcoes.map((opcao) => opcao.label)}::varchar[],
        ${opcoes.map((opcao) => opcao.color ?? null)}::varchar[],
        ${opcoes.map((opcao) => opcao.category ?? null)}::varchar[],
        ${opcoes.map((opcao) => opcao.position)}::int[]
      ) AS o(key, label, color, category, position)
      ON CONFLICT (tenant_id, kind, key) DO NOTHING
      RETURNING ${RETORNO_OPCAO_SQL}
    `,
  );
}

/**
 * @param {string} tenantId
 * @param {string} kind
 * @returns {Promise<number>} posição depois da última opção da lista
 */
export function proximaPosicao(tenantId, kind) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT COALESCE(max(position) + 1, 0)::int AS posicao
      FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind}
    `.then((rows) => rows[FIRST_RESULT_INDEX].posicao),
  );
}

/**
 * Label, cor, categoria e ativo de uma opção. `undefined` não muda;
 * `color: null` limpa a cor (por isso a flag `mudaCor` em vez de COALESCE).
 * `key` e `kind` nunca mudam.
 *
 * @param {string} tenantId
 * @param {string} opcaoId
 * @param {{ label?: string, color?: string | null, category?: string, ativo?: boolean }} mudancas
 * @returns {Promise<OpcaoLista | undefined>}
 */
export function atualizarOpcao(tenantId, opcaoId, { label, color, category, ativo }) {
  const mudaCor = color !== undefined;
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.crm_option
      SET label = COALESCE(${label ?? null}, label),
          color = CASE WHEN ${mudaCor} THEN ${color ?? null} ELSE color END,
          category = COALESCE(${category ?? null}, category),
          is_active = COALESCE(${ativo ?? null}::boolean, is_active),
          updated_at = now()
      WHERE id = ${opcaoId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING ${RETORNO_OPCAO_SQL}
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Nova ordem de uma lista: `position` = índice, num UPDATE só.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @param {string[]} idsEmOrdem
 */
export function reordenarOpcoes(tenantId, kind, idsEmOrdem) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.crm_option o
      SET position = nova.posicao - 1, updated_at = now()
      FROM unnest(${idsEmOrdem}::uuid[]) WITH ORDINALITY AS nova(id, posicao)
      WHERE o.id = nova.id AND o.tenant_id = ${tenantId}::uuid AND o.kind = ${kind}
    `,
  );
}

/**
 * Exclusão de verdade — o service só chama com zero leads usando a opção.
 *
 * @param {string} tenantId
 * @param {string} opcaoId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function excluirOpcao(tenantId, opcaoId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      DELETE FROM modulo_crm.crm_option
      WHERE id = ${opcaoId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Quantos leads usam cada key de uma lista (`tags`: cada lead conta uma
 * vez por tag); no tipo de atividade, quantas atividades (M6). Lead da
 * lixeira conta: pode ser restaurado.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @returns {Promise<Map<string, number>>}
 */
export async function contarUsos(tenantId, kind) {
  if (kind === TIPOS_LISTA.TIPO_ATIVIDADE) {
    const porTipo = await getTenantClient(
      tenantId,
      (tx) => tx.$queryRaw`
        SELECT tipo AS key, count(*)::int AS usos
        FROM modulo_crm.crm_activity
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY tipo
      `,
    );
    return new Map(porTipo.map((linha) => [linha.key, linha.usos]));
  }
  if (!COLUNA_DA_LISTA[kind]) return new Map();

  const linhas = await getTenantClient(tenantId, (tx) =>
    kind === TIPOS_LISTA.TAG
      ? tx.$queryRaw`
          SELECT tag AS key, count(*)::int AS usos
          FROM modulo_crm.leads l, unnest(l.tags) AS tag
          WHERE l.tenant_id = ${tenantId}::uuid
          GROUP BY tag
        `
      : tx.$queryRaw`
          SELECT ${colunaDoLead(kind)} AS key, count(*)::int AS usos
          FROM modulo_crm.leads l
          WHERE l.tenant_id = ${tenantId}::uuid AND ${colunaDoLead(kind)} IS NOT NULL
          GROUP BY 1
        `,
  );
  return new Map(linhas.map((linha) => [linha.key, linha.usos]));
}
