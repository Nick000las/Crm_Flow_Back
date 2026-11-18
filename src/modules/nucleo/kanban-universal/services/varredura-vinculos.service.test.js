import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registrarModulos } from '#core/registry/modules.js';
import { listarTenantsDoModulo } from '#core/tenant/module-access.js';

import { aplicarVarredura, listarEntidadesVinculadas } from '../adapters/vinculos.repository.js';
import { VINCULO } from '../constants.js';
import { criarModuloFalso } from '../testing/provedor-falso.js';
import { classificar, varrerVinculos } from './varredura-vinculos.service.js';

vi.mock('#core/tenant/module-access.js', () => ({ listarTenantsDoModulo: vi.fn() }));
vi.mock('../adapters/manutencao-queue.adapter.js', () => ({ agendarVarreduraDiaria: vi.fn() }));

vi.mock('../adapters/vinculos.repository.js', () => ({
  aplicarVarredura: vi.fn(),
  listarEntidadesVinculadas: vi.fn(),
}));

const TIPO = 'falsa';
const DOIS_LOTES = 2;
let modulo;

function resolverCom(mapa) {
  modulo.entidades[0].resolverVinculos = vi.fn().mockResolvedValue(mapa);
  registrarModulos([modulo]);
}

beforeEach(() => {
  vi.clearAllMocks();
  modulo = criarModuloFalso();
  registrarModulos([modulo]);
  vi.mocked(listarTenantsDoModulo).mockResolvedValue(['t1']);
  vi.mocked(aplicarVarredura).mockResolvedValue({ removidos: 1, repontados: 1 });
});

describe('classificar', () => {
  it('separa órfãos e trocas; id igual não muda nada', () => {
    expect(classificar({ a: null, b: 'b', c: 'd' })).toEqual({
      orfaos: ['a'],
      trocas: [{ de: 'c', para: 'd' }],
    });
  });
});

describe('varrerVinculos', () => {
  it('aplica as mudanças de cada tenant e soma no relatório', async () => {
    vi.mocked(listarEntidadesVinculadas).mockResolvedValue(['a', 'c']);
    resolverCom({ a: null, c: 'd' });

    await expect(varrerVinculos()).resolves.toEqual({
      tenants: 1,
      removidos: 1,
      repontados: 1,
      falhas: [],
    });

    expect(aplicarVarredura).toHaveBeenCalledWith('t1', TIPO, {
      orfaos: ['a'],
      trocas: [{ de: 'c', para: 'd' }],
    });
  });

  it('id que o provedor não devolveu fica como está', async () => {
    vi.mocked(listarEntidadesVinculadas).mockResolvedValue(['a']);
    resolverCom({});
    await varrerVinculos();
    expect(aplicarVarredura).not.toHaveBeenCalled();
  });

  it('percorre os lotes até acabar', async () => {
    const lote = Array.from({ length: VINCULO.LOTE_VARREDURA }, (_, indice) => `id-${indice}`);

    vi.mocked(listarEntidadesVinculadas).mockResolvedValueOnce(lote).mockResolvedValueOnce(['z']);
    resolverCom({});

    await varrerVinculos();

    expect(listarEntidadesVinculadas).toHaveBeenCalledTimes(DOIS_LOTES);
    expect(listarEntidadesVinculadas).toHaveBeenLastCalledWith('t1', TIPO, lote.at(-1));
  });

  it('falha em um tenant não para os outros', async () => {
    vi.mocked(listarTenantsDoModulo).mockResolvedValue(['t1', 't2']);

    vi.mocked(listarEntidadesVinculadas)
      .mockRejectedValueOnce(new Error('caiu'))
      .mockResolvedValueOnce(['a']);

    resolverCom({ a: null });

    const relatorio = await varrerVinculos();

    expect(relatorio.falhas).toEqual([{ tenantId: 't1', erro: 'caiu' }]);
    expect(relatorio.removidos).toBe(1);
  });
});
