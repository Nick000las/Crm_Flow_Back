import { beforeEach, describe, it, expect, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { executar, executarComEvento } from '../adapters/kanban.repository.js';
import { operarKanban } from './kanban.service.js';
vi.mock('../adapters/kanban.repository.js', () => ({
  executar: vi.fn(),
  executarComEvento: vi.fn(),
  verificarModulo: vi.fn(),
}));
describe('permissões Kanban', () => {
  const context = { tenantId: 'tenant', userId: 'user', role: 'OPERADOR' };
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it.each([
    'board.create',
    'board.update',
    'board.delete',
    'board.members.update',
    'column.create',
    'column.update',
    'column.delete',
    'column.reorder',
  ])('bloqueia %s para operador', (action) => {
    expect(() => operarKanban(context, action, 'id', {})).toThrow('Somente donos');
  });
  it.each(['OPERADOR', undefined, 'ADMIN'])('rejeita criação sem perfil autorizado: %s', (role) => {
    const publish = vi.fn();
    expect(() =>
      operarKanban({ ...context, role }, 'board.create', undefined, { nome: 'Quadro' }, publish),
    ).toThrow(expect.objectContaining({ statusCode: HTTP_STATUS.FORBIDDEN, code: 'FORBIDDEN' }));
    expect(executar).not.toHaveBeenCalled();
    expect(executarComEvento).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it.each([
    'card.create',
    'card.move',
    'card.delete',
    'comment.create',
    'board.get',
    'board.members',
  ])('permite %s para operador no próprio contexto', (action) => {
    operarKanban(context, action, 'id', {});
    expect(executar).toHaveBeenLastCalledWith('tenant', action, 'id', {}, context);
  });
  it.each(['DONO', 'MASTER'])('permite criação de quadro por %s', (role) => {
    const owner = { ...context, role };
    operarKanban(owner, 'board.create', undefined, { nome: 'Quadro' });
    expect(executar).toHaveBeenLastCalledWith(
      'tenant',
      'board.create',
      undefined,
      { nome: 'Quadro' },
      owner,
    );
  });
});

describe('publicação depois do commit', () => {
  const context = { tenantId: 'tenant', userId: 'owner', role: 'DONO' };
  it('não publica enquanto a transação está pendente', async () => {
    let commit;
    vi.mocked(executarComEvento).mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const publish = vi.fn().mockResolvedValue(undefined);
    const result = operarKanban(context, 'card.move', 'card', {}, publish);
    expect(publish).not.toHaveBeenCalled();
    const event = { boardId: 'board', type: 'card.move' };
    commit({ value: { id: 'card' }, event });
    await expect(result).resolves.toEqual({ id: 'card' });
    expect(publish).toHaveBeenCalledWith(event);
  });
  it('não publica alterações revertidas', async () => {
    vi.mocked(executarComEvento).mockRejectedValue(new Error('rollback'));
    const publish = vi.fn();
    await expect(operarKanban(context, 'card.create', 'board', {}, publish)).rejects.toThrow(
      'rollback',
    );
    expect(publish).not.toHaveBeenCalled();
  });
});
