import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * REPOSITORY: `notificacoes` (migration 0023). Tenant-scoped (RLS +
 * `tenant_id` no WHERE); toda leitura e marcação também filtra pelo
 * usuário — ninguém lê nem marca a notificação de outro.
 *
 * @typedef {{
 *   id: string, modulo: string, tipo: string, titulo: string, corpo: string | null,
 *   dados: Record<string, unknown>, lida_em: Date | null, created_at: Date,
 * }} Notificacao
 *
 * @typedef {{
 *   usuarioId: string, modulo: string, tipo: string, titulo: string,
 *   corpo?: string | null, dados?: Record<string, unknown>, chaveDedup: string,
 * }} NovaNotificacao
 */

/** Texto fixo deste arquivo — único motivo pra `Prisma.raw`. */
const COLUNAS = Prisma.raw('id, modulo, tipo, titulo, corpo, dados, lida_em, created_at');

/**
 * `ON CONFLICT DO NOTHING` na `(tenant_id, usuario_id, chave_dedup)`: gerar
 * de novo a mesma notificação não duplica.
 *
 * @param {string} tenantId
 * @param {NovaNotificacao[]} itens
 * @returns {Promise<number>} quantas entraram
 */
export function inserirNotificacoes(tenantId, itens) {
  if (itens.length === 0) return Promise.resolve(0);
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      INSERT INTO notificacoes (tenant_id, usuario_id, modulo, tipo, titulo, corpo, dados, chave_dedup)
      SELECT ${tenantId}::uuid, n.usuario_id, n.modulo, n.tipo, n.titulo, n.corpo, n.dados::jsonb, n.chave_dedup
      FROM unnest(
        ${itens.map((item) => item.usuarioId)}::uuid[],
        ${itens.map((item) => item.modulo)}::varchar[],
        ${itens.map((item) => item.tipo)}::varchar[],
        ${itens.map((item) => item.titulo)}::varchar[],
        ${itens.map((item) => item.corpo ?? null)}::text[],
        ${itens.map((item) => JSON.stringify(item.dados ?? {}))}::text[],
        ${itens.map((item) => item.chaveDedup)}::varchar[]
      ) AS n(usuario_id, modulo, tipo, titulo, corpo, dados, chave_dedup)
      ON CONFLICT (tenant_id, usuario_id, chave_dedup) DO NOTHING
    `,
  );
}

/**
 * Mais recentes primeiro, com o total e quantas faltam ler.
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ limite: number, offset: number }} paginacao
 * @returns {Promise<{ itens: Notificacao[], total: number, naoLidas: number }>}
 */
export function listarNotificacoesDoUsuario(tenantId, usuarioId, { limite, offset }) {
  return getTenantClient(tenantId, async (tx) => {
    const [contagem] = await tx.$queryRaw`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE lida_em IS NULL)::int AS nao_lidas
      FROM notificacoes
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
    `;
    const itens = await tx.$queryRaw`
      SELECT ${COLUNAS} FROM notificacoes
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
      ORDER BY created_at DESC, id
      LIMIT ${limite} OFFSET ${offset}
    `;
    return { itens, total: contagem.total, naoLidas: contagem.nao_lidas };
  });
}

/**
 * Marcar de novo não muda a data da primeira leitura.
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {string} notificacaoId
 * @returns {Promise<Notificacao | undefined>}
 */
export function marcarNotificacaoLida(tenantId, usuarioId, notificacaoId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE notificacoes SET lida_em = COALESCE(lida_em, now())
      WHERE id = ${notificacaoId}::uuid AND tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid
      RETURNING ${COLUNAS}
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<number>} quantas estavam por ler
 */
export function marcarTodasLidas(tenantId, usuarioId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE notificacoes SET lida_em = now()
      WHERE tenant_id = ${tenantId}::uuid AND usuario_id = ${usuarioId}::uuid AND lida_em IS NULL
    `,
  );
}
