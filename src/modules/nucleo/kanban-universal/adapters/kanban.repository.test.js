import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantClient } from '#core/db/tenantClient.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
const LOCK_AND_TWO_UPDATES = 3;
const LOCK_UPDATES_AND_ACTIVITY = 4;
import { executar as execute } from './kanban.repository.js';
const context = { userId: 'owner', role: 'DONO' };
const executar = (tenant, action, id, data) => execute(tenant, action, id, data, context);
vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));
describe('integridade de movimentação', () => {
  let tx;
  let cards;
  beforeEach(() => {
    vi.clearAllMocks();
    cards = [
      { id: 'card', board_id: 'board', coluna_id: 'source', updated_at: new Date('2026-01-01') },
      { id: 'other', board_id: 'board', coluna_id: 'source' },
    ];
    tx = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(async (sql) => {
        const query = sql.join('?');
        if (query.includes('tenant_modules')) {
          return [{ id: 'enabled' }];
        }
        if (query.includes('.boards')) {
          return [{ id: 'board' }];
        }
        if (query.includes('.colunas')) {
          return [
            { id: 'source', board_id: 'board' },
            { id: 'target', board_id: 'board' },
            { id: 'foreign', board_id: 'different-board' },
          ];
        }
        if (query.includes('.cards')) {
          return cards;
        }
        return [];
      }),
    };
    vi.mocked(getTenantClient).mockImplementation((tenant, callback) => callback(tx));
  });
  it('recusa edição antiga antes de gravar e preserva o card atual', async () => {
    await expect(
      executar('tenant', 'card.update', 'card', {
        titulo: 'Rascunho antigo',
        expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(tx.$queryRaw.mock.calls.some(([sql]) => sql.join('?').startsWith('UPDATE'))).toBe(false);
  });
  it('mescla detalhes sem apagar os campos específicos do quadro', async () => {
    cards[0].dados_extras = { leadId: 'lead', descricao: 'Contexto', prioridade: 'baixa' };
    await executar('tenant', 'card.update', 'card', { dadosExtras: { prioridade: 'alta' } });
    const [, , , details] = tx.$queryRaw.mock.calls.find(([sql]) =>
      sql.join('?').startsWith('UPDATE'),
    );
    expect(JSON.parse(details)).toEqual({
      leadId: 'lead',
      descricao: 'Contexto',
      prioridade: 'alta',
    });
  });
  it('rejeita card invisível ou inexistente sem alterar dados', async () => {
    await expect(
      executar('tenant', 'card.move', 'missing', { novaColunaId: 'target', novaOrdem: 0 }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // Apenas lock, nenhuma alteração.
  });
  it('rejeita coluna de outro quadro', async () => {
    await expect(
      executar('tenant', 'card.move', 'card', { novaColunaId: 'foreign', novaOrdem: 0 }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('reordena origem e destino na mesma transação e informa conflito', async () => {
    const result = await executar('tenant', 'card.move', 'card', {
      novaColunaId: 'target',
      novaOrdem: 0,
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(getTenantClient).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(LOCK_AND_TWO_UPDATES);
    expect(result.conflito).toBe(true);
  });
  it('reordena dentro da coluna uma única vez e registra atividade', async () => {
    await executar('tenant', 'card.move', 'card', { novaColunaId: 'source', novaOrdem: 1 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(LOCK_UPDATES_AND_ACTIVITY);
  });
  it('impede excluir coluna ocupada', async () => {
    await expect(executar('tenant', 'column.delete', 'source')).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
    });
  });
  it('bloqueia tenant sem módulo', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(executar('tenant', 'card.get', 'card')).rejects.toMatchObject({
      statusCode: HTTP_STATUS.FORBIDDEN,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
