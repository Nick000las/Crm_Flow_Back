import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantClient } from '#core/db/tenantClient.js';
import { TIPOS_LISTA } from '../constants.js';
import { atualizarOpcao, contarUsos, inserirOpcoes } from './crm-options.repository.js';

/** SQL gerado pelo adapter das listas (`crm_option`). */

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID = '11111111-1111-1111-1111-111111111111';
const USOS = 2;

let chamadas;
let resposta;

function registrar(strings, values) {
  const texto = strings.reduce((acc, parte, i) => {
    const valor = values[i - 1];
    const fragmento = valor && typeof valor === 'object' && 'sql' in valor ? valor.sql : '?';
    return acc + fragmento + parte;
  });
  chamadas.push({ sql: texto.replace(/\s+/g, ' '), values });
}

const tx = {
  $queryRaw: vi.fn(async (strings, ...values) => {
    registrar(strings, values);
    return resposta;
  }),
};

beforeEach(() => {
  chamadas = [];
  resposta = [];
  getTenantClient.mockImplementation((_tenantId, callback) => callback(tx));
});

describe('contarUsos', () => {
  it('lista escalar agrupa pela coluna fixa do mapa (nunca texto do cliente)', async () => {
    resposta = [{ key: 'ganho', usos: USOS }];
    const usos = await contarUsos(TENANT, TIPOS_LISTA.STATUS);
    expect(chamadas[0].sql).toContain('SELECT l.status AS key');
    expect(usos.get('ganho')).toBe(USOS);
  });

  it('tags contam pelo unnest; tipo de atividade conta as atividades (M6)', async () => {
    await contarUsos(TENANT, TIPOS_LISTA.TAG);
    expect(chamadas[0].sql).toContain('unnest(l.tags)');

    chamadas = [];
    await contarUsos(TENANT, TIPOS_LISTA.TIPO_ATIVIDADE);
    expect(chamadas[0].sql).toContain('FROM modulo_crm.crm_activity');
  });
});

describe('inserirOpcoes', () => {
  it('um INSERT só, idempotente pela key; lista vazia não consulta', async () => {
    await inserirOpcoes(TENANT, TIPOS_LISTA.FONTE_LEAD, [{ key: 'a', label: 'A', position: 0 }]);
    expect(chamadas[0].sql).toContain('ON CONFLICT (tenant_id, kind, key) DO NOTHING');
    expect(chamadas[0].values).toContainEqual(['a']);

    chamadas = [];
    await expect(inserirOpcoes(TENANT, TIPOS_LISTA.FONTE_LEAD, [])).resolves.toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
});

describe('atualizarOpcao', () => {
  it('cor omitida não muda; cor null limpa (flag explícita, não COALESCE)', async () => {
    await atualizarOpcao(TENANT, ID, { label: 'Novo nome' });
    expect(chamadas[0].sql).toContain('color = CASE WHEN ? THEN ? ELSE color END');
    expect(chamadas[0].values).toContain(false);

    await atualizarOpcao(TENANT, ID, { color: null });
    expect(chamadas[1].values).toContain(true);
  });
});
