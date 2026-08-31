import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantClient } from '#core/db/tenantClient.js';
import { salvarParticipantes } from './board-members.repository.js';
import { executar } from './kanban.repository.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));
vi.mock('./board-members.repository.js', () => ({
  salvarParticipantes: vi.fn(),
  listarParticipantes: vi.fn(),
  exigirParticipacao: vi.fn(),
}));

describe('criação de quadro com modelo', () => {
  let tx;
  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      $queryRaw: vi.fn(async (sql) => {
        const query = sql.join('?');
        if (query.includes('tenant_modules')) {
          return [{ id: 'enabled' }];
        }
        if (query.includes('INSERT INTO')) {
          return [{ id: 'board', nome: 'Projeto' }];
        }
        return [];
      }),
      $executeRaw: vi.fn(),
    };
    vi.mocked(getTenantClient).mockImplementation((tenant, callback) => callback(tx));
    vi.mocked(salvarParticipantes).mockResolvedValue([{ id: 'owner', ativo: true }]);
  });

  it('grava as colunas ordenadas na mesma transação do quadro e da equipe', async () => {
    const stages = ['A fazer', 'Em andamento', 'Concluído'];
    await executar(
      'tenant',
      'board.create',
      undefined,
      {
        nome: 'Projeto',
        boardType: 'projetos',
        colunasIniciais: stages,
      },
      { userId: 'owner', role: 'DONO' },
    );
    expect(getTenantClient).toHaveBeenCalledTimes(1);
    expect(salvarParticipantes).toHaveBeenCalledWith(tx, 'tenant', 'board', ['owner'], undefined);
    const insert = tx.$executeRaw.mock.calls.find(([sql]) => sql.join('?').includes('unnest'));
    expect(insert.slice(1)).toEqual(['tenant', 'board', stages]);
    expect(insert[0].join('?')).toContain('(posicao - 1)::integer');
  });

  it.each([undefined, []])(
    'mantém criação sem colunas para payload %j',
    async (colunasIniciais) => {
      await executar(
        'tenant',
        'board.create',
        undefined,
        {
          nome: 'Projeto',
          boardType: 'projetos',
          colunasIniciais,
        },
        { userId: 'owner', role: 'DONO' },
      );
      expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('?').includes('unnest'))).toBe(
        false,
      );
    },
  );

  it('propaga falha das colunas para o gateway reverter a transação', async () => {
    tx.$executeRaw.mockImplementation(async (sql) => {
      if (sql.join('?').includes('unnest')) {
        throw new Error('Falha nas colunas');
      }
    });
    await expect(
      executar(
        'tenant',
        'board.create',
        undefined,
        {
          nome: 'Projeto',
          boardType: 'projetos',
          colunasIniciais: ['A fazer'],
        },
        { userId: 'owner', role: 'DONO' },
      ),
    ).rejects.toThrow('Falha nas colunas');
  });
});
