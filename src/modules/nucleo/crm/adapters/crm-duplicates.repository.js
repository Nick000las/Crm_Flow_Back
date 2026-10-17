import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { CAMPOS_DUPLICIDADE, LIMITE_CANDIDATOS_DUPLICIDADE } from '../constants.js';

/**
 * ADAPTER: regras de duplicidade (`crm_duplicate_rule`) e busca de
 * candidatos pelas colunas `dedup_*` de `leads` (migration 0020).
 */

/**
 * @param {string} tenantId
 * @returns {Promise<{ campo: string, acao: string, ativo: boolean }[]>}
 */
export function buscarRegras(tenantId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT campo, acao, ativo FROM modulo_crm.crm_duplicate_rule
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY campo
    `,
  );
}

/**
 * Grava o conjunto completo (upsert por campo), numa transação.
 *
 * @param {string} tenantId
 * @param {{ campo: string, acao: string, ativo: boolean }[]} regras
 */
export function salvarRegras(tenantId, regras) {
  return getTenantClient(tenantId, async (tx) => {
    for (const regra of regras) {
      await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_duplicate_rule (tenant_id, campo, acao, ativo)
        VALUES (${tenantId}::uuid, ${regra.campo}, ${regra.acao}, ${regra.ativo})
        ON CONFLICT (tenant_id, campo)
        DO UPDATE SET acao = EXCLUDED.acao, ativo = EXCLUDED.ativo, updated_at = now()
      `;
    }
  });
}

/**
 * Import (passo Revisar): todos os leads que casam com alguma chave da
 * planilha, numa consulta só — o service distribui por linha. Vem com as
 * chaves `dedup_*` pra comparar em memória.
 *
 * @param {string} tenantId
 * @param {Partial<Record<keyof typeof CAMPOS_DUPLICIDADE, string[]>>} chavesPorCampo
 * @returns {Promise<Array<{ id: string, nome: string } & Record<string, string | null>>>}
 */
export function buscarCandidatosEmLote(tenantId, chavesPorCampo) {
  const entradas = Object.entries(chavesPorCampo).filter(
    ([campo, chaves]) => CAMPOS_DUPLICIDADE[campo] && chaves.length > 0,
  );
  if (entradas.length === 0) return Promise.resolve([]);

  const condicoes = entradas.map(
    ([campo, chaves]) => Prisma.sql`${Prisma.raw(`l.${CAMPOS_DUPLICIDADE[campo].coluna}`)} = ANY(${chaves}::text[])`,
  );
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT l.id, l.nome, l.dedup_email, l.dedup_telefone, l.dedup_cnpj, l.dedup_cpf
      FROM modulo_crm.leads l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        AND (${Prisma.join(condicoes, ' OR ')})
      ORDER BY l.created_at
    `,
  );
}

/**
 * Leads fora da lixeira (arquivado conta) com a mesma chave em alguma das
 * colunas pedidas. Devolve quais campos casaram em cada um.
 *
 * @param {string} tenantId
 * @param {Partial<Record<keyof typeof CAMPOS_DUPLICIDADE, string>>} chaves  `campo` → chave normalizada
 * @param {string | null} [ignorarId] o próprio lead, na edição
 * @returns {Promise<{ id: string, nome: string, campos: string[] }[]>}
 */
export function buscarCandidatos(tenantId, chaves, ignorarId = null) {
  const entradas = Object.entries(chaves).filter(([campo, chave]) => CAMPOS_DUPLICIDADE[campo] && chave);
  if (entradas.length === 0) return Promise.resolve([]);

  const coluna = (campo) => Prisma.raw(`l.${CAMPOS_DUPLICIDADE[campo].coluna}`);
  const condicoes = entradas.map(([campo, chave]) => Prisma.sql`${coluna(campo)} = ${chave}`);
  const casados = entradas.map(
    ([campo, chave]) => Prisma.sql`CASE WHEN ${coluna(campo)} = ${chave} THEN ${campo} END`,
  );

  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT l.id, l.nome, array_remove(ARRAY[${Prisma.join(casados)}]::text[], NULL) AS campos
      FROM modulo_crm.leads l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        AND (${Prisma.join(condicoes, ' OR ')})
        AND (${ignorarId}::uuid IS NULL OR l.id <> ${ignorarId}::uuid)
      ORDER BY l.created_at
      LIMIT ${LIMITE_CANDIDATOS_DUPLICIDADE}
    `,
  );
}
