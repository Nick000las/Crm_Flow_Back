import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salvarView, excluirView } from './filter-views.service.js';
import { listarCamposDoTenant } from './leads.service.js';
import {
  buscarViewPorNome,
  criarView,
  removerView,
} from '../adapters/filter-views.repository.js';

vi.mock('./leads.service.js', () => ({ listarCamposDoTenant: vi.fn() }));
vi.mock('../adapters/filter-views.repository.js', () => ({
  buscarViewsDoUsuario: vi.fn(),
  buscarViewPorNome: vi.fn(),
  criarView: vi.fn(),
  removerView: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const USUARIO = '00000000-0000-0000-0000-000000000002';
const FILTROS = { filtros: [{ chave: 'status', operador: 'igual', valor: 'ganho' }] };

beforeEach(() => {
  vi.clearAllMocks();
  listarCamposDoTenant.mockResolvedValue([{ chave: 'status', label: 'Status', tipo: 'selecao', camada: 1 }]);
  buscarViewPorNome.mockResolvedValue(undefined);
  criarView.mockResolvedValue({ id: 'view-1', nome: 'Ganhos', filtros: FILTROS });
});

describe('salvarView', () => {
  it('salva view com filtro válido', async () => {
    await expect(salvarView(TENANT, USUARIO, { nome: 'Ganhos', filtros: FILTROS })).resolves.toMatchObject({
      id: 'view-1',
    });
    expect(criarView).toHaveBeenCalledWith(TENANT, USUARIO, { nome: 'Ganhos', filtros: FILTROS });
  });

  it('não salva view com filtro que já nasce inválido', async () => {
    const filtros = { filtros: [{ chave: 'cpf', operador: 'igual', valor: '1' }] };
    await expect(salvarView(TENANT, USUARIO, { nome: 'X', filtros })).rejects.toThrow('não é um campo ativo');
    expect(criarView).not.toHaveBeenCalled();
  });

  it('nome repetido pro mesmo usuário → conflito', async () => {
    buscarViewPorNome.mockResolvedValue({ id: 'view-0' });
    await expect(salvarView(TENANT, USUARIO, { nome: 'Ganhos', filtros: FILTROS })).rejects.toThrow(
      'Você já tem uma view com esse nome',
    );
  });
});

describe('excluirView', () => {
  it('404 quando a view não existe ou é de outro usuário', async () => {
    removerView.mockResolvedValue(undefined);
    await expect(excluirView(TENANT, USUARIO, 'view-x')).rejects.toThrow('View não encontrada');
  });
});
