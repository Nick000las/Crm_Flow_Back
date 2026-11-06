import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { buscarBoardsPorTenant } from '../adapters/boards.repository.js';
import { listarBoardsDoTenant } from './boards.service.js';
import { listarQuadrosDeEntidade } from './quadro-entidade.service.js';

vi.mock('../adapters/boards.repository.js', () => ({
  buscarBoardsPorTenant: vi.fn(),
}));
vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('./quadro-entidade.service.js', () => ({ listarQuadrosDeEntidade: vi.fn() }));

const context = { tenantId: 'tenant-1', userId: 'user-1', role: 'OPERADOR' };
const logger = { warn: vi.fn() };
const boards = [
  {
    id: 'board-1',
    boardType: 'projetos',
    nome: 'Entregas',
    createdAt: new Date('2026-08-31T12:00:00.000Z'),
  },
];

describe('listarBoardsDoTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarBoardsPorTenant).mockResolvedValue(boards);
  });

  it('flag desligada: resposta de sempre, sem consultar provedor', async () => {
    vi.mocked(featureAtiva).mockResolvedValue(false);

    const resultado = await listarBoardsDoTenant(context, logger);

    expect(buscarBoardsPorTenant).toHaveBeenCalledWith(context);
    expect(featureAtiva).toHaveBeenCalledWith('tenant-1', 'kanban_universal.quadros_entidade');
    expect(resultado).toBe(boards);
    expect(listarQuadrosDeEntidade).not.toHaveBeenCalled();
  });

  it('flag ligada: junta nativos e quadros dos provedores, com o modo', async () => {
    const deEntidade = { boardType: 'b', quadroRef: 'q', nome: 'Vendas', modo: 'entidade' };
    vi.mocked(featureAtiva).mockResolvedValue(true);
    vi.mocked(listarQuadrosDeEntidade).mockResolvedValue([deEntidade]);

    await expect(listarBoardsDoTenant(context, logger)).resolves.toEqual([
      { ...boards[0], modo: 'nativo' },
      deEntidade,
    ]);
    expect(listarQuadrosDeEntidade).toHaveBeenCalledWith(context, logger);
  });
});
