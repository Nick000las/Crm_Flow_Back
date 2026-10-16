import { describe, expect, it, vi } from 'vitest';
import { reconciliarTenant } from './reconcile.service.js';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('reconciliarTenant', () => {
  it('sem passos não faz nada', async () => {
    await expect(reconciliarTenant(TENANT, [])).resolves.toEqual([]);
  });

  it('roda os passos em ordem e devolve o relatório de cada um', async () => {
    const ordem = [];
    const passos = [
      { nome: 'primeiro', executar: vi.fn(async () => ordem.push('primeiro') && 'a') },
      { nome: 'segundo', executar: vi.fn(async () => ordem.push('segundo') && 'b') },
    ];

    const relatorio = await reconciliarTenant(TENANT, passos);

    expect(ordem).toEqual(['primeiro', 'segundo']);
    expect(passos[0].executar).toHaveBeenCalledWith(TENANT);
    expect(relatorio).toEqual([
      { passo: 'primeiro', resultado: 'a' },
      { passo: 'segundo', resultado: 'b' },
    ]);
  });

  it('para no primeiro passo que falha (o seguinte pode depender dele)', async () => {
    const segundo = { nome: 'segundo', executar: vi.fn() };
    const passos = [{ nome: 'quebra', executar: () => Promise.reject(new Error('falhou')) }, segundo];

    await expect(reconciliarTenant(TENANT, passos)).rejects.toThrow('falhou');
    expect(segundo.executar).not.toHaveBeenCalled();
  });
});
