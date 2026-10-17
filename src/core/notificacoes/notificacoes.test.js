import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { listarNotificacoesDoUsuario, marcarNotificacaoLida } from './notificacoes.repository.js';
import { listarNotificacoes, marcarComoLida } from './notificacoes.js';

vi.mock('./notificacoes.repository.js', () => ({
  inserirNotificacoes: vi.fn(),
  listarNotificacoesDoUsuario: vi.fn(),
  marcarNotificacaoLida: vi.fn(),
  marcarTodasLidas: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const USUARIO = '00000000-0000-0000-0000-000000000002';
const PAGINA = 3;
const TAMANHO = 10;

beforeEach(() => vi.clearAllMocks());

describe('notificações in-app (core)', () => {
  it('lista paginada do próprio usuário, com quantas faltam ler', async () => {
    listarNotificacoesDoUsuario.mockResolvedValue({ itens: [], total: 0, naoLidas: 0 });
    const paginacao = { pagina: PAGINA, tamanho: TAMANHO };
    await expect(listarNotificacoes(TENANT, USUARIO, paginacao)).resolves.toEqual({
      itens: [],
      total: 0,
      naoLidas: 0,
      ...paginacao,
    });
    expect(listarNotificacoesDoUsuario).toHaveBeenCalledWith(TENANT, USUARIO, {
      limite: paginacao.tamanho,
      offset: (paginacao.pagina - 1) * paginacao.tamanho,
    });
  });

  it('marcar a de outro usuário (ou inexistente) → 404', async () => {
    marcarNotificacaoLida.mockResolvedValue(undefined);
    await expect(marcarComoLida(TENANT, USUARIO, 'n-1')).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
  });
});
