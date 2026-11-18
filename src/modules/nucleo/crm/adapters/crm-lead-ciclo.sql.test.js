import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTenantClient } from '#core/db/tenantClient.js';

import {
  cicloDeVidaSql,
  clienteDesdeSql,
  colunasDoCiclo,
  diaNoFuso,
  oportunidadesAbertasSql,
  ultimaCompraSql,
} from './crm-lead-ciclo.sql.js';
import { buscarLeadPorId, buscarLeadsComFiltro } from './leads.repository.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000002';
const OCULTO = '00000000-0000-0000-0000-0000000000aa';
const FUSO = 'America/Sao_Paulo';
const DETALHE_E_BUSCA = 2;

describe('expressões do ciclo de vida (FC4)', () => {
  it('sem ocultos: só fora das excluídas, sem filtro de pipeline', () => {
    const { sql } = clienteDesdeSql([]);

    expect(sql).toContain('d.lead_id = l.id');
    expect(sql).toContain('d.tenant_id = l.tenant_id');
    expect(sql).toContain('AND d.deleted_at IS NULL');
    expect(sql).not.toContain('<> ALL');
  });

  it('com ocultos: todas as expressões tiram os pipelines ocultos', () => {
    for (const expressao of [
      clienteDesdeSql,
      ultimaCompraSql,
      oportunidadesAbertasSql,
      cicloDeVidaSql,
    ]) {
      const consulta = expressao([OCULTO]);

      expect(consulta.sql).toContain('d.pipeline_id <> ALL(?::uuid[])');
      expect(consulta.values).toContainEqual([OCULTO]);
    }
  });

  it('pessoa na lixeira conta as oportunidades que foram junto', () => {
    const { sql } = oportunidadesAbertasSql([]);

    expect(sql).toMatch(/CASE WHEN l\.deleted_at IS NULL\s+THEN .*d\.deleted_at IS NULL.*ELSE/s);

    const senaoNaLixeira = sql.slice(sql.lastIndexOf('ELSE'));

    expect(senaoNaLixeira).not.toContain('d.deleted_at');
  });

  it('cliente desde e última compra: primeira e última ganha em vendas', () => {
    const desde = clienteDesdeSql([]);
    const ultima = ultimaCompraSql([]);

    expect(desde.sql).toContain('min(d.won_at)');
    expect(ultima.sql).toContain('max(d.won_at)');
    expect(desde.values).toEqual(expect.arrayContaining(['ganho', 'sales']));
    // Arquivada ganha conta como cliente: nada de `archived_at` aqui.
    expect(desde.sql).not.toContain('archived_at');
  });

  it('abertas: não arquivadas, de qualquer tipo de pipeline', () => {
    const { sql, values } = oportunidadesAbertasSql([]);

    expect(sql).toContain('count(*)::int');
    expect(sql).toContain('d.archived_at IS NULL');
    expect(sql).not.toContain('p.type');
    expect(values).toContain('aberto');
  });

  it('ciclo: a regra de recalcularPessoa (cliente, oportunidade, lead)', () => {
    const { sql, values } = cicloDeVidaSql([]);

    expect(sql).toContain('bool_or');
    expect(values).toEqual(expect.arrayContaining(['cliente', 'oportunidade', 'lead']));
  });

  it('colunasDoCiclo dá os quatro nomes da resposta', () => {
    const { sql } = colunasDoCiclo([]);

    for (const coluna of [
      'ciclo_de_vida',
      'cliente_desde',
      'ultima_compra',
      'oportunidades_abertas',
    ]) {
      expect(sql).toContain(`AS ${coluna}`);
    }
  });

  it('dia no fuso: won_at (UTC sem fuso) vira hora local antes do ::date', () => {
    const { sql, values } = diaNoFuso(Prisma.sql`x`, FUSO);

    expect(sql).toBe("((x AT TIME ZONE 'UTC') AT TIME ZONE ?)::date");
    expect(values).toEqual([FUSO]);
  });
});

describe('leitura do lead com o ciclo (FC4)', () => {
  let queries;
  const tx = {
    $queryRaw: vi.fn(async (strings, ...values) => {
      const query = Prisma.sql(strings, ...values);

      queries.push(query);

      if (query.sql.includes('COUNT(*)::int AS total')) {
        return [{ total: 1 }];
      }

      return [{ id: LEAD }];
    }),
  };

  beforeEach(() => {
    queries = [];
    getTenantClient.mockImplementation((_id, run) => run(tx));
  });

  it('detalhe e busca trazem as colunas, contando sem os pipelines ocultos', async () => {
    await buscarLeadPorId(TENANT, LEAD, { ocultos: [OCULTO] });
    await buscarLeadsComFiltro(TENANT, [], { limite: 1, offset: 0, ocultos: [OCULTO] });

    const leituras = queries.filter((query) => query.sql.includes('AS ciclo_de_vida'));

    expect(leituras).toHaveLength(DETALHE_E_BUSCA);

    for (const leitura of leituras) {
      expect(leitura.sql).toContain('AS oportunidades_abertas');
      expect(leitura.values).toContainEqual([OCULTO]);
    }
  });
});
