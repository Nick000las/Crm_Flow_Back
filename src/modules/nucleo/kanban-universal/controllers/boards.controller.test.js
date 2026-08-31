import { describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { listarBoardsDoTenant } from '../services/boards.service.js';
import { registrarRotasBoards } from './boards.controller.js';

vi.mock('../services/boards.service.js', () => ({
  listarBoardsDoTenant: vi.fn(),
}));

describe('GET /kanban/boards', () => {
  it('usa o tenant autenticado e devolve o envelope padrão da API', async () => {
    const boards = [{ id: 'board-1', boardType: 'crm_leads', nome: 'Funil comercial' }];
    vi.mocked(listarBoardsDoTenant).mockResolvedValue(boards);

    let handler;
    const app = {
      get: vi.fn((path, routeHandler) => {
        handler = routeHandler;
      }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    registrarRotasBoards(app);
    const context = { tenantId: 'tenant-1', userId: 'user-1', role: 'OPERADOR' };
    await handler({ tenantContext: context }, reply);

    expect(app.get).toHaveBeenCalledWith('/kanban/boards', expect.any(Function));
    expect(listarBoardsDoTenant).toHaveBeenCalledWith(context);
    expect(reply.code).toHaveBeenCalledWith(HTTP_STATUS.OK);
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: HTTP_STATUS.OK,
      data: boards,
    });
  });
});
