import { describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { exigirParticipacao, salvarParticipantes } from './board-members.repository.js';

function transaction(users) {
  return { $queryRaw: vi.fn().mockResolvedValue(users), $executeRaw: vi.fn() };
}

const LARGE_TEAM_SIZE = 250;
describe('equipe do quadro', () => {
  it('insere equipe grande em um lote parametrizado na mesma transação', async () => {
    const users = Array.from({ length: LARGE_TEAM_SIZE }, (_, index) => ({ id: `user-${index}` }));
    const ids = users.map((user) => user.id);
    const tx = transaction(users);
    await salvarParticipantes(tx, 'tenant', 'board', ids);
    const inserts = tx.$executeRaw.mock.calls.filter(([sql]) =>
      sql.join('?').includes('INSERT INTO'),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].slice(1)).toEqual(['tenant', 'board', ids]);
    expect(inserts[0][0].join('?')).toContain('unnest');
  });

  it('permite que o operador ativo participante acesse o quadro', async () => {
    const tx = transaction([{ id: 'operator', ativo: true }]);
    await expect(
      exigirParticipacao(tx, 'tenant', 'board', { role: 'OPERADOR', userId: 'operator' }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { users: [] },
    { users: [{ id: 'other', ativo: true }] },
    { users: [{ id: 'operator', ativo: false }] },
  ])('nega acesso sem participação ativa: %j', async ({ users }) => {
    const tx = transaction(users);
    await expect(
      exigirParticipacao(tx, 'tenant', 'board', { role: 'OPERADOR', userId: 'operator' }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
  });

  it.each(['DONO', 'MASTER'])('mantém acesso de gestão para %s', async (role) => {
    const tx = transaction([]);
    await exigirParticipacao(tx, 'tenant', 'board', { role, userId: 'owner' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejeita usuários inativos ou de outra empresa antes de alterar equipe', async () => {
    const tx = transaction([]);
    await expect(
      salvarParticipantes(tx, 'tenant', 'board', ['foreign-user']),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('permite limpar a equipe e remove as atribuições dos participantes removidos', async () => {
    const tx = transaction([]);
    await salvarParticipantes(tx, 'tenant', 'board', []);
    const updates = tx.$executeRaw.mock.calls.map(([sql]) => sql.join('?'));
    expect(
      updates.some((sql) => sql.includes('DELETE FROM modulo_kanban_universal.board_members')),
    ).toBe(true);
    expect(updates.some((sql) => sql.includes('SET responsavel_id = NULL'))).toBe(true);
    expect(updates.every((sql) => sql.includes('tenant_id') && sql.includes('board_id'))).toBe(
      true,
    );
  });
});
