import { beforeEach, expect, it, vi } from 'vitest';
import { getTenantClient } from '#core/db/tenantClient.js';
import { Prisma } from '@prisma/client';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { fonteLeads } from './crm-lead-read-model.js';
import { buscarLeadPorId, buscarLeadsComFiltro } from './leads.repository.js';
import { contarUsos } from './crm-options.repository.js';
import { colunaEsfriandoDesde } from './crm-inatividade.sql.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));
const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000002';
let capabilities;
let queries;
const tx = {
  $queryRaw: vi.fn(async (strings, ...values) => {
    const query = Prisma.sql(strings, ...values);
    queries.push(query);
    if (query.sql.includes('to_regclass')) return [capabilities];
    if (query.sql.includes('COUNT(*)::int AS total')) return [{ total: 1 }];
    if (query.sql.includes('count(*)::int AS usos')) return [{ key: 'novo', usos: 1 }];
    return [{ id: LEAD }];
  }),
};
beforeEach(() => {
  queries = [];
  capabilities = { oportunidades: true, funil_legado: false, principal_deal: true };
  getTenantClient.mockImplementation((_id, run) => run(tx));
});

it('modelo atual resolve campos comerciais pela oportunidade principal e etapa do mesmo tenant e pipeline', async () => {
  const source = await fonteLeads(tx);
  expect(source.sql).toContain('negocio.id = contato.principal_deal_id');
  expect(source.sql).toContain('negocio.tenant_id = contato.tenant_id');
  expect(source.sql).toContain('negocio.lead_id = contato.id');
  expect(source.sql).toContain('negocio.deleted_at IS NULL');
  expect(source.sql).toContain('etapa.pipeline_id = negocio.pipeline_id');
  expect(source.sql).toContain('negocio.amount AS valor');
  expect(source.sql).not.toContain('funil_estagios');
});

it('modelo legado mantém estágio e colunas nativas sem consultar crm_deal', async () => {
  capabilities = { oportunidades: false, funil_legado: true, status_legado: true };
  const source = await fonteLeads(tx);
  expect(source.sql).toContain('modulo_crm.funil_estagios');
  expect(source.sql).toContain('etapa.tenant_id = contato.tenant_id');
  expect(source.sql).not.toContain('crm_deal');
});

it('schema incompleto informa indisponibilidade sem fabricar dados', async () => {
  capabilities = { oportunidades: false, funil_legado: false };
  await expect(fonteLeads(tx)).rejects.toMatchObject({
    code: 'CRM_SCHEMA_INCOMPATIBLE',
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
  });
});

it('tabela de funil remanescente não força o modelo antigo quando status já saiu do lead', async () => {
  capabilities = {
    oportunidades: true,
    funil_legado: true,
    status_legado: false,
    principal_deal: true,
  };
  expect((await fonteLeads(tx)).sql).toContain('contato.principal_deal_id');
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
  expect(queries.at(-1).sql).toContain('ORDER BY l.estagio_ordem, l.created_at DESC, l.id');
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

it('inatividade distingue status de pipelines diferentes, mantendo suporte ao legado', () => {
  expect(colunaEsfriandoDesde(new Date()).sql).toContain(
    "(to_jsonb(o)->>'pipeline_id') IS NOT DISTINCT FROM (to_jsonb(l)->>'pipeline_id')",
  );
});
