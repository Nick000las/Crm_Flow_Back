import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buscarPessoasPorIds,
  buscarSituacaoDasPessoas,
} from '../adapters/crm-pessoa-entidade.repository.js';
import { identificadorDoLayout } from './layout.service.js';
import { obterSchemaDoPapel } from './permissoes.service.js';
import { provedorDePessoa, tituloDaPessoa } from './pessoa-entidade.service.js';

vi.mock('./visibilidade-pipeline.service.js', () => ({
  pessoasVisiveis: vi.fn(async (_tenantId, ids) => new Set(ids)),
}));

vi.mock('../adapters/crm-pessoa-entidade.repository.js', () => ({
  buscarPessoasPorIds: vi.fn(),
  buscarSituacaoDasPessoas: vi.fn(),
}));

vi.mock('./layout.service.js', () => ({ identificadorDoLayout: vi.fn() }));

vi.mock('./permissoes.service.js', async (original) => ({
  ...(await original()),
  obterSchemaDoPapel: vi.fn(),
}));

const context = { tenantId: 'tenant', userId: 'user', role: 'OPERADOR' };
const situacao = (origem, extras = {}) => ({
  origem,
  atual: origem,
  anonimizado: false,
  excluido: false,
  ...extras,
});
const schema = { definicoes: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identificadorDoLayout).mockResolvedValue(null);
  vi.mocked(obterSchemaDoPapel).mockResolvedValue(schema);
});

describe('tituloDaPessoa', () => {
  it('sem identificador, ou com ele vazio, vale o nome', () => {
    const lead = { nome: 'Ana', empresa: '  ' };

    expect(tituloDaPessoa(lead, null, schema)).toBe('Ana');
    expect(tituloDaPessoa(lead, { chave: 'empresa', coluna: 'empresa' }, schema)).toBe('Ana');
  });

  it('usa o campo do layout, de coluna ou personalizado', () => {
    expect(
      tituloDaPessoa(
        { nome: 'Ana', empresa: 'ACME' },
        { chave: 'empresa', coluna: 'empresa' },
        schema,
      ),
    ).toBe('ACME');

    expect(
      tituloDaPessoa(
        { nome: 'Ana', custom_fields: { 'campo-1': 'Aninha' } },
        { chave: 'apelido' },
        { definicoes: [{ id: 'campo-1', chave: 'apelido', tipo: 'texto' }] },
      ),
    ).toBe('Aninha');
  });
});

describe('descrever', () => {
  it('anonimizado e na lixeira ficam de fora; existe só o nome do lead visível', async () => {
    vi.mocked(buscarSituacaoDasPessoas).mockResolvedValue([
      situacao('a'),
      situacao('b', { anonimizado: true }),
      situacao('c', { excluido: true }),
    ]);

    vi.mocked(buscarPessoasPorIds).mockResolvedValue([{ id: 'a', nome: 'Ana' }]);

    await expect(provedorDePessoa.descrever(context, ['a', 'b', 'c', 'd'])).resolves.toEqual([
      { id: 'a', idAtual: 'a', titulo: 'Ana', subtitulo: null, destaques: [] },
    ]);

    expect(buscarPessoasPorIds).toHaveBeenCalledWith('tenant', ['a']);
  });

  it('nada visível: não consulta os leads', async () => {
    vi.mocked(buscarSituacaoDasPessoas).mockResolvedValue([situacao('b', { anonimizado: true })]);
    await expect(provedorDePessoa.descrever(context, ['b'])).resolves.toEqual([]);
    expect(buscarPessoasPorIds).not.toHaveBeenCalled();
  });

  it('identificador oculto para o papel: cai no nome, sem revelar o campo', async () => {
    vi.mocked(buscarSituacaoDasPessoas).mockResolvedValue([situacao('a')]);
    vi.mocked(buscarPessoasPorIds).mockResolvedValue([{ id: 'a', nome: 'Ana', cpf: '111' }]);
    vi.mocked(identificadorDoLayout).mockResolvedValue({ chave: 'cpf', coluna: 'cpf' });

    vi.mocked(obterSchemaDoPapel).mockResolvedValue({
      ...schema,
      restritos: new Map([['cpf', { acesso: 'hidden' }]]),
    });

    const [pessoa] = await provedorDePessoa.descrever(context, ['a']);

    expect(pessoa.titulo).toBe('Ana');
    expect(obterSchemaDoPapel).toHaveBeenCalledWith('tenant', 'OPERADOR');
  });

  it('mesclado responde pelo principal', async () => {
    vi.mocked(buscarSituacaoDasPessoas).mockResolvedValue([situacao('a', { atual: 'b' })]);
    vi.mocked(buscarPessoasPorIds).mockResolvedValue([{ id: 'b', nome: 'Bia' }]);

    const [pessoa] = await provedorDePessoa.descrever(context, ['a']);

    expect(pessoa).toMatchObject({ id: 'a', idAtual: 'b', titulo: 'Bia' });
  });
});

describe('resolverVinculos', () => {
  it('mesclado vai ao principal; anonimizado e inexistente viram null; lixeira fica', async () => {
    vi.mocked(buscarSituacaoDasPessoas).mockResolvedValue([
      situacao('a', { atual: 'b' }),
      situacao('c', { anonimizado: true }),
      situacao('d', { excluido: true }),
    ]);

    await expect(
      provedorDePessoa.resolverVinculos('tenant', ['a', 'c', 'd', 'e']),
    ).resolves.toEqual({ a: 'b', c: null, d: 'd', e: null });
  });
});
