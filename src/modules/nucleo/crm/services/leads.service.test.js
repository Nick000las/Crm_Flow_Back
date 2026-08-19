import { describe, it, expect, vi } from 'vitest';
import { registrarNovoLead } from './leads.service.js';

vi.mock('../adapters/leads.repository.js', () => ({
  criarLead: vi.fn().mockResolvedValue({ id: 'lead-123' }),
}));

describe('registrarNovoLead', () => {
  it('rejeita nome vazio antes de chamar o adapter', async () => {
    await expect(
      registrarNovoLead('tenant-1', { nome: '  ', telefone: '11999999999', funilEstagioId: 'x' }),
    ).rejects.toThrow('Nome do lead não pode ser vazio');
  });

  it('cria lead com nome válido', async () => {
    const resultado = await registrarNovoLead('tenant-1', {
      nome: 'João',
      telefone: '11999999999',
      funilEstagioId: 'estagio-1',
    });
    expect(resultado).toEqual({ id: 'lead-123' });
  });
});
