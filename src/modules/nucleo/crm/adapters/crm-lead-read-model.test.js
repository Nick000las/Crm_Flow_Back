import { Prisma } from '@prisma/client';
import { beforeEach, expect, it, vi } from 'vitest';

import { getTenantClient } from '#core/db/tenantClient.js';

import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';
import { FONTE_LEADS } from './crm-lead-read-model.js';
import { contarUsos } from './crm-options.repository.js';
import { buscarLeadPorId, buscarLeadsComFiltro } from './leads.repository.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000002';
let queries;
const tx = {
  $queryRaw: vi.fn(async (strings, ...values) => {
    const query = Prisma.sql(strings, ...values);

    queries.push({ sql: query.sql.replace(/\s+/g, ' ').trim(), values: query.values });

    if (query.sql.includes('COUNT(*)::int AS total')) {
      return [{ total: 1 }];
    }

    if (query.sql.includes('count(*)::int AS usos')) {
      return [{ key: 'novo', usos: 1 }];
    }

    return [{ id: LEAD }];
  }),
};

beforeEach(() => {
  queries = [];
  getTenantClient.mockImplementation((_id, run) => run(tx));
});

it('campos comerciais vêm da oportunidade principal, e a etapa do mesmo tenant e pipeline', () => {
  const { sql } = FONTE_LEADS;

  expect(sql).toContain('negocio.id = contato.principal_deal_id');
  expect(sql).toContain('negocio.tenant_id = contato.tenant_id');
  expect(sql).toContain('negocio.lead_id = contato.id');
  expect(sql).toContain('etapa.pipeline_id = negocio.pipeline_id');
  expect(sql).toContain('negocio.amount AS valor');
});

it('busca e total usam a mesma projeção, tenant e filtros com paginação estável', async () => {
  const result = await buscarLeadsComFiltro(TENANT, [Prisma.sql`l.deleted_at IS NULL`], {
    limite: 1,
    offset: 0,
  });

  expect(result).toEqual({ total: 1, itens: [{ id: LEAD }] });

  for (const query of queries.slice(1)) {
    expect(query.sql).toContain('contato.principal_deal_id');
    expect(query.sql).toContain('l.tenant_id = ?::uuid');
    expect(query.sql).toContain('l.deleted_at IS NULL');
    expect(query.values).toContain(TENANT);
  }

  expect(queries.at(-1).sql).toContain('ORDER BY l.created_at DESC, l.id');
});

it('detalhe usa o mesmo modelo e continua limitado por tenant e id', async () => {
  expect(await buscarLeadPorId(TENANT, LEAD)).toEqual({ id: LEAD });
  expect(queries.at(-1).values).toContain(TENANT);
  expect(queries.at(-1).values).toContain(LEAD);
  expect(queries.at(-1).sql).toContain('contato.principal_deal_id');
});

it('usos de status e motivo contam todas as oportunidades, inclusive as não principais', async () => {
  for (const kind of ['status', 'motivo_perda']) {
    const counts = await contarUsos(TENANT, kind);

    expect(counts.get('novo')).toBe(1);
    expect(queries.at(-1).sql).toContain('FROM modulo_crm.crm_deal d');
    expect(queries.at(-1).sql).not.toContain('principal_deal_id');
    expect(queries.at(-1).values).toContain(TENANT);
  }
});

it('inatividade distingue status de pipelines diferentes', () => {
  expect(colunaEsfriandoDesde(new Date()).sql).toContain('o.pipeline_id = l.pipeline_id');
});
