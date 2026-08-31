import { describe, expect, it, vi } from 'vitest';
import { buscarBoardsPorTenant } from '../adapters/boards.repository.js';
import { listarBoardsDoTenant } from './boards.service.js';

vi.mock('../adapters/boards.repository.js', () => ({
  buscarBoardsPorTenant: vi.fn(),
}));

describe('listarBoardsDoTenant', () => {
  it('consulta e devolve apenas os boards do tenant informado', async () => {
    const boards = [
      {
        id: 'board-1',
        boardType: 'crm_leads',
        nome: 'Funil comercial',
        createdAt: new Date('2026-08-31T12:00:00.000Z'),
      },
    ];
    vi.mocked(buscarBoardsPorTenant).mockResolvedValue(boards);

    const context = { tenantId: 'tenant-1', userId: 'user-1', role: 'OPERADOR' };
    const resultado = await listarBoardsDoTenant(context);

    expect(buscarBoardsPorTenant).toHaveBeenCalledWith(context);
    expect(resultado).toBe(boards);
  });
});
