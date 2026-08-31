import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { registrarRotasKanbanCompleto } from './kanban.controller.js';
import { operarKanban } from '../services/kanban.service.js';
vi.mock('../services/kanban.service.js', () => ({ operarKanban: vi.fn() }));
const INVALID_NAME_LENGTH = 201;
const INVALID_COLUMN_COUNT = 11;
const id = 'd6b67f66-266b-423e-8c86-c25ae13a739c';
async function appForTest() {
  const app = Fastify();
  registerErrorHandlers(app);
  app.addHook('preHandler', async (request) => {
    request.tenantContext = { tenantId: id, userId: id, role: 'DONO' };
  });
  registrarRotasKanbanCompleto(app);
  return app;
}
describe('contrato HTTP Kanban', () => {
  it('valida UUID antes de acessar service', async () => {
    const app = await appForTest();
    const response = await app.inject({ method: 'GET', url: '/kanban/cards/invalido' });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });
  it('rejeita tenant_id e campos arbitrários no body', async () => {
    const app = await appForTest();
    const response = await app.inject({
      method: 'POST',
      url: '/kanban/boards',
      payload: { nome: 'Quadro', boardType: 'projetos', tenant_id: id },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });
  it('rejeita posições negativas', async () => {
    const app = await appForTest();
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/cards/${id}/mover`,
      payload: { novaColunaId: id, novaOrdem: -1 },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });
  it('encaminha a movimentação com o contexto autenticado', async () => {
    vi.mocked(operarKanban).mockResolvedValue({ id, ordem: 0 });
    const app = await appForTest();
    const payload = { novaColunaId: id, novaOrdem: 0 };
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/cards/${id}/mover`,
      payload,
    });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(operarKanban).toHaveBeenLastCalledWith(
      { tenantId: id, userId: id, role: 'DONO' },
      'card.move',
      id,
      payload,
      undefined,
    );
    expect(response.json().data).toEqual({ id, ordem: 0 });
    await app.close();
  });
});

describe('contrato da equipe do quadro', () => {
  it('encaminha a equipe na criação do quadro', async () => {
    vi.mocked(operarKanban).mockResolvedValue({ id });
    const app = await appForTest();
    const payload = { nome: 'Projeto', boardType: 'projetos', participantes: [id] };
    const response = await app.inject({ method: 'POST', url: '/kanban/boards', payload });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(operarKanban).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: id }),
      'board.create',
      undefined,
      payload,
      undefined,
    );
    await app.close();
  });

  it('rejeita participantes duplicados', async () => {
    const app = await appForTest();
    const response = await app.inject({
      method: 'PUT',
      url: `/kanban/boards/${id}/membros`,
      payload: { participantes: [id, id] },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });

  it('valida UUID dos participantes', async () => {
    const app = await appForTest();
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/boards/${id}`,
      payload: { nome: 'Quadro', participantes: ['invalido'] },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });
});

describe('colunas iniciais do quadro', () => {
  it('encaminha as etapas do modelo com os nomes normalizados', async () => {
    const app = await appForTest();
    const payload = {
      nome: 'Projeto',
      boardType: 'projetos',
      participantes: [],
      colunasIniciais: [' A fazer ', 'Em andamento', 'Concluído'],
    };
    const response = await app.inject({ method: 'POST', url: '/kanban/boards', payload });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(operarKanban).toHaveBeenLastCalledWith(
      expect.any(Object),
      'board.create',
      undefined,
      { ...payload, colunasIniciais: ['A fazer', 'Em andamento', 'Concluído'] },
      undefined,
    );
    await app.close();
  });
  it.each([
    [''],
    ['   '],
    ['x'.repeat(INVALID_NAME_LENGTH)],
    Array(INVALID_COLUMN_COUNT).fill('Etapa'),
  ])('recusa modelo com etapas inválidas: %j', async (...colunasIniciais) => {
    const app = await appForTest();
    const response = await app.inject({
      method: 'POST',
      url: '/kanban/boards',
      payload: { nome: 'Projeto', boardType: 'projetos', colunasIniciais },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    await app.close();
  });
});
