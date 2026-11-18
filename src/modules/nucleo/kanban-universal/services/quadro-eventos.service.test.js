import { beforeEach, describe, expect, it, vi } from 'vitest';

import { provedoresDeQuadro } from '#core/quadros/registro.js';

import { DESPACHO_DE_QUADROS } from '../constants.js';
import { agruparPorQuadro, despacharEventos } from './quadro-eventos.service.js';

vi.mock('#core/quadros/registro.js', () => ({
  provedoresDeQuadro: vi.fn(),
  provedorDoQuadro: vi.fn(),
  provedorDaEntidade: vi.fn(),
}));

const lote = (quantos) => ({
  ids: Array.from({ length: quantos }, (_, indice) => `evento-${indice}`),
  eventos: [{ tenantId: 't1', quadroRef: 'q1', entidadeId: 'c1' }],
});

const DOIS_LOTES = 2;

describe('agruparPorQuadro', () => {
  it('um aviso por quadro, sem repetir card', () => {
    const mudancas = agruparPorQuadro('crm', [
      { tenantId: 't1', quadroRef: 'q1', entidadeId: 'c1' },
      { tenantId: 't1', quadroRef: 'q1', entidadeId: 'c1' },
      { tenantId: 't1', quadroRef: 'q1', entidadeId: 'c2' },
      { tenantId: 't1', quadroRef: 'q2', entidadeId: 'c3' },
    ]);

    expect(mudancas).toEqual([
      { tenantId: 't1', boardType: 'crm', quadroRef: 'q1', entidadeIds: ['c1', 'c2'] },
      { tenantId: 't1', boardType: 'crm', quadroRef: 'q2', entidadeIds: ['c3'] },
    ]);
  });

  it('nunca junta tenants, mesmo com o mesmo quadro', () => {
    const mudancas = agruparPorQuadro('crm', [
      { tenantId: 't1', quadroRef: 'q1', entidadeId: 'c1' },
      { tenantId: 't2', quadroRef: 'q1', entidadeId: 'c2' },
    ]);

    expect(mudancas.map((mudanca) => mudanca.tenantId)).toEqual(['t1', 't2']);
  });
});

describe('despacharEventos', () => {
  const provedor = {
    boardType: 'crm',
    drenarEventos: vi.fn(),
    confirmarEventos: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provedoresDeQuadro.mockReturnValue([provedor, { boardType: 'sem_tempo_real' }]);
  });

  it('emite e só então confirma', async () => {
    const ordem = [];

    provedor.drenarEventos.mockResolvedValue(lote(1));
    provedor.confirmarEventos.mockImplementation(async () => ordem.push('confirmou'));

    await despacharEventos(() => ordem.push('emitiu'));

    expect(ordem).toEqual(['emitiu', 'confirmou']);
  });

  it('falha ao emitir não confirma: o evento volta depois da reserva', async () => {
    provedor.drenarEventos.mockResolvedValue(lote(1));

    await expect(
      despacharEventos(() => {
        throw new Error('sem broker');
      }),
    ).rejects.toThrow('sem broker');

    expect(provedor.confirmarEventos).not.toHaveBeenCalled();
  });

  it('lote cheio continua; lote parcial encerra a rodada', async () => {
    provedor.drenarEventos
      .mockResolvedValueOnce(lote(DESPACHO_DE_QUADROS.LOTE))
      .mockResolvedValueOnce(lote(1));

    await despacharEventos(vi.fn());

    expect(provedor.drenarEventos).toHaveBeenCalledTimes(DOIS_LOTES);
  });

  it('fila enorme não segura a rodada', async () => {
    provedor.drenarEventos.mockResolvedValue(lote(DESPACHO_DE_QUADROS.LOTE));

    await despacharEventos(vi.fn());

    expect(provedor.drenarEventos).toHaveBeenCalledTimes(DESPACHO_DE_QUADROS.MAX_LOTES);
  });
});
