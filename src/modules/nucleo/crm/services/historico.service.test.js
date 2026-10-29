import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { listarEventosDoLead } from '../adapters/crm-lead-events.repository.js';
import { garantirFeature } from '#core/tenant/feature-flags.js';
import { buscarNomesDeUsuarios } from '../adapters/usuarios.repository.js';
import { CAMADA } from '../constants.js';
import { categoriasDoEvento, diffDoLead, listarHistorico, visiveisDoSchema } from './historico.service.js';
import { obterSchemaCampos } from './field-schema.service.js';

vi.mock('../adapters/leads.repository.js', () => ({ buscarLeadPorId: vi.fn() }));
vi.mock('../adapters/crm-lead-events.repository.js', () => ({ listarEventosDoLead: vi.fn() }));
vi.mock('./field-schema.service.js', () => ({ obterSchemaCampos: vi.fn() }));
vi.mock('../adapters/usuarios.repository.js', () => ({ buscarNomesDeUsuarios: vi.fn(async () => new Map()) }));
vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn(), garantirFeature: vi.fn() }));

const ID_SEGMENTO = '11111111-1111-1111-1111-111111111111';
const ID_EXCLUIDO = '22222222-2222-2222-2222-222222222222';
const VALOR_ANTES = 1500.5;
const VALOR_DEPOIS = 2000;
const TAMANHO_PAGINA = 50;
const PAGINA = { pagina: 1, tamanho: TAMANHO_PAGINA };
const DOIS_EVENTOS = 2;

const LEAD = {
  nome: 'Ana',
  email: 'ana@x.com',
  telefone: '11999999999',
  status: 'novo',
  tags: ['vip'],
  valor: new Prisma.Decimal(VALOR_ANTES),
  funil_estagio_id: 'estagio-1',
  estagio_nome: 'Contato',
  usuario_responsavel_id: 'u-1',
  data_conversao: new Date('2026-10-01T00:00:00Z'),
  ultima_interacao_em: null,
  custom_fields: { [ID_SEGMENTO]: 'varejo' },
};

describe('diffDoLead', () => {
  it('sem mudança, diff vazio (Decimal e Date iguais por valor)', () => {
    const copia = {
      ...LEAD,
      valor: new Prisma.Decimal(VALOR_ANTES),
      data_conversao: new Date('2026-10-01T00:00:00Z'),
      tags: ['vip'],
    };
    expect(diffDoLead(LEAD, copia)).toEqual([]);
  });

  it('só os campos alterados, com antes e depois serializáveis', () => {
    const depois = {
      ...LEAD,
      status: 'ganho',
      valor: new Prisma.Decimal(VALOR_DEPOIS),
      data_conversao: new Date('2026-10-16T00:00:00Z'),
      tags: ['vip', 'b2b'],
    };
    expect(diffDoLead(LEAD, depois)).toEqual([
      { campo: 'status', antes: 'novo', depois: 'ganho' },
      { campo: 'tags', antes: ['vip'], depois: ['vip', 'b2b'] },
      { campo: 'dataConversao', antes: '2026-10-01T00:00:00.000Z', depois: '2026-10-16T00:00:00.000Z' },
      { campo: 'valor', antes: VALOR_ANTES, depois: VALOR_DEPOIS },
    ]);
  });

  it('estágio guarda o id e o nome do momento', () => {
    const depois = { ...LEAD, funil_estagio_id: 'estagio-2', estagio_nome: 'Proposta' };
    expect(diffDoLead(LEAD, depois)).toEqual([
      { campo: 'funilEstagioId', antes: 'estagio-1', depois: 'estagio-2', antesNome: 'Contato', depoisNome: 'Proposta' },
    ]);
  });

  it('personalizado pelo id do campo, incluindo valor limpo', () => {
    const depois = { ...LEAD, custom_fields: {} };
    expect(diffDoLead(LEAD, depois)).toEqual([
      { campo: 'customFields', campoId: ID_SEGMENTO, antes: 'varejo', depois: null },
    ]);
  });

  it('`ignorar` tira o campo do diff (interação atualizada pela regra de status)', () => {
    const depois = { ...LEAD, status: 'ganho', ultima_interacao_em: new Date() };
    expect(diffDoLead(LEAD, depois, { ignorar: ['ultimaInteracaoEm'] }).map((entrada) => entrada.campo)).toEqual([
      'status',
    ]);
  });
});

describe('listarHistorico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1' });
    obterSchemaCampos.mockResolvedValue({
      campos: [
        { chave: 'status', label: 'Situação', tipo: 'selecao', camada: CAMADA.CAMADA_1, opcoesLista: [{ key: 'ganho' }] },
        { chave: 'segmento', label: 'Segmento', tipo: 'texto', camada: CAMADA.CAMADA_3 },
      ],
      definicoes: [
        { id: ID_SEGMENTO, chave: 'segmento', label: 'Segmento', tipo: 'texto' },
        { id: ID_EXCLUIDO, chave: 'antigo', label: 'Antigo', tipo: 'texto' },
      ],
    });
  });

  it('lead na lixeira ou inexistente → 404', async () => {
    buscarLeadPorId.mockResolvedValueOnce(undefined);
    await expect(listarHistorico('tenant-1', 'lead-x', PAGINA)).rejects.toThrow('Lead não encontrado');
  });

  it('descreve o diff pelo schema de agora; campo desligado ou excluído sai', async () => {
    listarEventosDoLead.mockResolvedValueOnce({
      total: 1,
      itens: [
        {
          id: 'ev-1',
          tipo: 'atualizado',
          autor_id: 'u-1',
          autor_nome: 'Dono',
          created_at: new Date('2026-10-16T12:00:00Z'),
          diff: [
            { campo: 'status', antes: 'novo', depois: 'ganho' },
            { campo: 'cpf', antes: null, depois: '123' }, // Camada 2 desligada
            { campo: 'customFields', campoId: ID_SEGMENTO, antes: null, depois: 'varejo' },
            { campo: 'customFields', campoId: ID_EXCLUIDO, antes: 'x', depois: null }, // não está em `campos`
            { campo: 'valor', antes: VALOR_ANTES, depois: VALOR_DEPOIS },
          ],
        },
      ],
    });

    const { itens, total } = await listarHistorico('tenant-1', 'lead-1', PAGINA);
    expect(total).toBe(1);
    expect(itens[0]).toMatchObject({ id: 'ev-1', tipo: 'atualizado', autor: { id: 'u-1', nome: 'Dono' } });
    expect(itens[0].diff.map((entrada) => [entrada.chave, entrada.label])).toEqual([
      ['status', 'Situação'], // label renomeado vale pro histórico antigo
      ['segmento', 'Segmento'],
      ['valor', 'Valor'],
    ]);
    expect(itens[0].diff[0].opcoesLista).toEqual([{ key: 'ganho' }]);
  });

  // M16: timeline.
  it('responsável e personalizado "usuario" com nome; CNPJ do enriquecimento só pra quem vê o CNPJ', async () => {
    const DONO = '33333333-3333-3333-3333-333333333333';
    const VENDEDOR = '44444444-4444-4444-4444-444444444444';
    buscarNomesDeUsuarios.mockResolvedValueOnce(new Map([[DONO, 'Dono'], [VENDEDOR, 'Vendedor']]));
    listarEventosDoLead.mockResolvedValueOnce({
      total: DOIS_EVENTOS,
      itens: [
        {
          id: 'ev-2',
          tipo: 'atualizado',
          created_at: new Date(),
          diff: [{ campo: 'usuarioResponsavelId', antes: DONO, depois: VENDEDOR }],
        },
        { id: 'ev-3', tipo: 'enriquecido', created_at: new Date(), diff: [], detalhes: { cnpj: '11222333000181', provedor: 'brasilapi' } },
      ],
    });

    const { itens } = await listarHistorico('tenant-1', 'lead-1', PAGINA);
    expect(buscarNomesDeUsuarios).toHaveBeenCalledWith('tenant-1', [DONO, VENDEDOR]);
    expect(itens[0]).toMatchObject({ categorias: ['campos', 'atribuicao'] });
    expect(itens[0].diff[0]).toMatchObject({ chave: 'usuarioResponsavelId', antesNome: 'Dono', depoisNome: 'Vendedor' });
    expect(itens[1].detalhes).toEqual({ provedor: 'brasilapi' }); // CNPJ não está nos campos ligados
    // A visibilidade vai pro SQL (edição só de campo oculto some do total).
    expect(listarEventosDoLead).toHaveBeenCalledWith(
      'tenant-1',
      'lead-1',
      expect.objectContaining({ categorias: [], visiveis: expect.objectContaining({ campoIds: [ID_SEGMENTO] }) }),
    );
    expect(garantirFeature).not.toHaveBeenCalled();
  });

  it('filtrar por categoria exige a flag crm.timeline', async () => {
    listarEventosDoLead.mockResolvedValueOnce({ total: 0, itens: [] });
    await listarHistorico('tenant-1', 'lead-1', { ...PAGINA, categorias: ['ciclo'] });
    expect(garantirFeature).toHaveBeenCalledWith('tenant-1', 'crm.timeline');
  });
});

describe('timeline (M16): funções puras', () => {
  it('categoriasDoEvento: edição, troca de responsável, distribuição, mesclagem, ciclo', () => {
    expect(categoriasDoEvento({ tipo: 'atualizado', diff: [{ campo: 'status' }] })).toEqual(['campos']);
    expect(categoriasDoEvento({ tipo: 'atualizado', diff: [{ campo: 'usuarioResponsavelId' }] })).toEqual([
      'campos',
      'atribuicao',
    ]);
    expect(categoriasDoEvento({ tipo: 'criado', diff: [], detalhes: { distribuicao: { origem: 'regra' } } })).toEqual([
      'atribuicao',
      'ciclo',
    ]);
    expect(categoriasDoEvento({ tipo: 'mesclado', diff: [] })).toEqual(['mesclagem']);
    expect(categoriasDoEvento({ tipo: 'enriquecido', diff: [] })).toEqual(['enriquecimento']);
    expect(categoriasDoEvento({ tipo: 'anonimizado', diff: null })).toEqual(['ciclo']);
  });

  it('visiveisDoSchema: sistema ligado + propriedades; personalizado só se ligado', () => {
    const visiveis = visiveisDoSchema({
      campos: [
        { chave: 'status', camada: CAMADA.CAMADA_1 },
        { chave: 'segmento', camada: CAMADA.CAMADA_3 },
      ],
      definicoes: [
        { id: ID_SEGMENTO, chave: 'segmento' },
        { id: ID_EXCLUIDO, chave: 'oculto' },
      ],
    });
    expect(visiveis.chaves).toEqual(['status', 'valor', 'funilEstagioId', 'usuarioResponsavelId']);
    expect(visiveis.campoIds).toEqual([ID_SEGMENTO]);
  });
});
