import { describe, it, expect } from 'vitest';
import { getAdminClient } from '#core/db/tenantClient.js';

/**
 * Par do rls-coverage: toda tabela com `tenant_id` tem FK pra `tenants`.
 * Sem ela, excluir um tenant deixa linha órfã (ninguém vê, por RLS, mas o
 * dado fica) — foi o drift corrigido na migration 0015.
 */

const prisma = getAdminClient();
const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('Cobertura de FK de tenant', () => {
  it('nenhuma tabela com tenant_id deve estar sem FK para tenants', async () => {
    /** @type {{ schema: string, tabela: string }[]} */
    const semFk = await prisma.$queryRaw`
      SELECT c.table_schema AS schema, c.table_name AS tabela
      FROM information_schema.columns c
      JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
      WHERE c.column_name = 'tenant_id'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint k
          WHERE k.contype = 'f'
            AND k.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
            AND k.confrelid = 'public.tenants'::regclass
        )
      ORDER BY 1, 2
    `;

    if (semFk.length > 0) {
      const lista = semFk.map((t) => `  - ${t.schema}.${t.tabela}`).join('\n');
      throw new Error(`Tabelas com tenant_id SEM FK para tenants:\n${lista}\n\nVer migration 0015.`);
    }
    expect(semFk).toHaveLength(0);
  });
});
