import { describe, it, expect } from 'vitest';
import { getAdminClient } from '#core/db/tenantClient.js';

/** BLOQUEADOR DE MERGE (Bloco 2.1). Varre TODAS as tabelas do banco (qualquer schema). */

const prisma = getAdminClient();

/**
 * @typedef {object} TabelaSemRLS
 * @property {string} schema
 * @property {string} tabela
 */

describe('Cobertura de RLS multi-tenant', () => {
  it('nenhuma tabela com tenant_id deve estar sem RLS habilitado', async () => {
    /** @type {TabelaSemRLS[]} */
    const tabelasSemRLS = await prisma.$queryRaw`
      SELECT c.table_schema AS schema, c.table_name AS tabela
      FROM information_schema.columns c
      JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
      LEFT JOIN pg_class pc ON pc.relname = c.table_name
      LEFT JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
      WHERE c.column_name = 'tenant_id'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND pc.relrowsecurity IS DISTINCT FROM true
    `;

    if (tabelasSemRLS.length > 0) {
      const lista = tabelasSemRLS.map((t) => `  - ${t.schema}.${t.tabela}`).join('\n');
      throw new Error(`Tabelas com tenant_id SEM RLS:\n${lista}\n\nVer MODULE_CONTRACT.md, seção 5.`);
    }
    expect(tabelasSemRLS).toHaveLength(0);
  });
});
