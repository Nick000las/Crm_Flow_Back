import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantClient } from '#core/db/tenantClient.js';
import { LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';
import {
  atualizarCampoConfigurado,
  criarCampoPersonalizado,
  desativarCampoPersonalizado,
  editarCampoPersonalizado,
  existeValorDoCampo,
  inserirCamposSistema,
  reordenarCampos,
} from './crm-fields.repository.js';

/**
 * SQL gerado pelo adapter único de campos (`crm_field`). `tx` falso
 * registra cada chamada; cada função tem que caber numa transação só.
 */

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID = '11111111-1111-1111-1111-111111111111';
const ORDEM = 4;

let chamadas;
let respostasQuery;

/** Junta o texto do template e dos fragmentos `Prisma.raw` interpolados. */
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
    return respostasQuery.shift() ?? [];
  }),
  $executeRaw: vi.fn(async (strings, ...values) => {
    registrar(strings, values);
    return 1;
  }),
};

beforeEach(() => {
  chamadas = [];
  respostasQuery = [];
  getTenantClient.mockClear();
  getTenantClient.mockImplementation((_tenantId, fn) => fn(tx));
});

const sqls = () => chamadas.map((chamada) => chamada.sql);

describe('campos personalizados', () => {
  it('criar insere em crm_field com o formato da API e as 4 visibilidades, numa transação', async () => {
    respostasQuery.push([{ id: ID, chave: 'origem' }]);

    const criado = await criarCampoPersonalizado(TENANT, {
      chave: 'origem',
      label: 'Origem',
      tipo: 'selecao',
      opcoes: ['site'],
      obrigatorio: false,
      ordem: ORDEM,
    });

    expect(criado.id).toBe(ID);
    expect(getTenantClient).toHaveBeenCalledTimes(1);
    expect(sqls()[0]).toContain('INSERT INTO modulo_crm.crm_field');
    expect(sqls()[0]).toContain('type AS tipo');
    expect(chamadas[0].values).toContain(JSON.stringify(['site'])); // array → JSON pro ::jsonb
    expect(sqls()[1]).toContain('INSERT INTO modulo_crm.crm_field_visibility');
    expect(chamadas[1].values).toContainEqual(LISTA_CONTEXTOS_VISIBILIDADE);
  });

  it('editar e excluir só tocam personalizado ativo; excluir é desativar', async () => {
    await editarCampoPersonalizado(TENANT, ID, { label: 'Canal', tipo: 'texto', opcoes: null, obrigatorio: true });
    await desativarCampoPersonalizado(TENANT, ID);

    expect(sqls()[0]).toContain('WHERE id = ?::uuid AND tenant_id = ?::uuid AND system_key IS NULL AND is_active');
    expect(chamadas[0].values).toContain(null); // opções de texto viram SQL NULL
    expect(sqls()[1]).toContain('SET is_active = false');
    expect(sqls().some((sql) => sql.includes('DELETE'))).toBe(false);
  });
});

describe('inserirCamposSistema (reconcile)', () => {
  it('só cria visibilidade pro campo que acabou de nascer — o existente não é sobrescrito', async () => {
    respostasQuery.push([{ id: 'novo' }], []); // 1º criado, 2º já existia (ON CONFLICT DO NOTHING)

    const criados = await inserirCamposSistema(TENANT, [
      { systemKey: 'empresa', label: 'Empresa', tipo: 'texto', position: 0, isRequired: false, visivel: false },
      { systemKey: 'cargo', label: 'Cargo', tipo: 'texto', position: 0, isRequired: false, visivel: false },
    ]);

    expect(criados).toBe(1);
    expect(sqls().filter((sql) => sql.includes('crm_field_visibility'))).toHaveLength(1);
    expect(sqls()[0]).toContain('ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING');
  });
});

describe('área Configurações (M2)', () => {
  it('um campo: label/obrigatório + só os contextos enviados, numa transação', async () => {
    await atualizarCampoConfigurado(TENANT, ID, { label: 'Razão social', visibilidade: { table: false } });

    expect(getTenantClient).toHaveBeenCalledTimes(1);
    expect(sqls()[0]).toContain('SET label = COALESCE(?, label)');
    expect(chamadas[1].values).toEqual(expect.arrayContaining([ID, 'table', false]));
    expect(sqls()).toHaveLength(['crm_field', 'contexto table'].length);
  });

  it('reordenar grava todas as posições num UPDATE só', async () => {
    const ids = [ID, '22222222-2222-2222-2222-222222222222'];
    await reordenarCampos(TENANT, ids);

    expect(sqls()).toHaveLength(1);
    expect(sqls()[0]).toContain('WITH ORDINALITY');
    expect(chamadas[0].values).toContainEqual(ids);
  });
});

describe('existeValorDoCampo', () => {
  it('procura o id do campo em custom_fields do tenant (operador do índice GIN)', async () => {
    respostasQuery = [[{ existe: true }]];
    await expect(existeValorDoCampo(TENANT, ID)).resolves.toBe(true);
    expect(chamadas[0].sql).toContain('custom_fields ? ?');
    expect(chamadas[0].values).toEqual([TENANT, ID]);
  });

  it('sem linha devolve false', async () => {
    respostasQuery = [[{ existe: false }]];
    await expect(existeValorDoCampo(TENANT, ID)).resolves.toBe(false);
  });
});
