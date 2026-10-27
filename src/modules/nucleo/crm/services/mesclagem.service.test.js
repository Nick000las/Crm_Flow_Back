import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mesclarLeads as mesclarLeadsRepository } from '../adapters/leads.repository.js';
import { mesclarLeads, montarMesclagem } from './mesclagem.service.js';

// M14: a pontuação tem teste próprio; aqui ela não grava nada.
vi.mock('./score.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recalcularScoreDosLeads: vi.fn().mockResolvedValue(null),
  garantirScoreNaoEditado: vi.fn(),
}));
vi.mock('../adapters/leads.repository.js', () => ({ mesclarLeads: vi.fn() }));
vi.mock('./leads.service.js', () => ({ buscarLeadFormatado: vi.fn(async (_tenant, id) => ({ id })) }));
vi.mock('./field-schema.service.js', () => ({
  obterSchemaCampos: vi.fn(async () => ({ definicoes: [{ id: 'id-segmento', chave: 'segmento' }] })),
}));

const VALOR_PRINCIPAL = 100;
const VALOR_SECUNDARIO = 250;
const NOTA = 9;

const PRINCIPAL = {
  id: 'p',
  nome: 'Ana',
  email: 'ana@x.com',
  telefone: null,
  empresa: null,
  status: 'novo',
  tags: ['vip'],
  valor: new Prisma.Decimal(VALOR_PRINCIPAL),
  funil_estagio_id: 'estagio-1',
  usuario_responsavel_id: 'u-1',
  ultima_interacao_em: new Date('2026-10-01T00:00:00Z'),
  custom_fields: { 'id-segmento': 'varejo' },
};
const SECUNDARIO = {
  id: 's',
  nome: 'Ana Souza',
  email: 'ana.souza@x.com',
  telefone: '11987654321',
  empresa: 'Acme',
  status: 'ganho',
  tags: ['vip', 'b2b'],
  valor: new Prisma.Decimal(VALOR_SECUNDARIO),
  funil_estagio_id: 'estagio-2',
  usuario_responsavel_id: 'u-2',
  ultima_interacao_em: new Date('2026-10-10T00:00:00Z'),
  custom_fields: { 'id-segmento': 'industria', 'id-nota': NOTA },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('montarMesclagem (pura)', () => {
  it('sem escolha: o do principal, ou o do secundário quando o principal está vazio', () => {
    const dados = montarMesclagem(PRINCIPAL, SECUNDARIO);
    expect(dados).toMatchObject({
      nome: 'Ana',
      email: 'ana@x.com',
      telefone: '11987654321', // principal vazio
      empresa: 'Acme',
      status: 'novo',
      valor: VALOR_PRINCIPAL, // Decimal → número
      funilEstagioId: 'estagio-1',
      usuarioResponsavelId: 'u-1',
    });
  });

  it('escolha campo a campo, inclusive personalizado (pelo id)', () => {
    const dados = montarMesclagem(PRINCIPAL, SECUNDARIO, {
      nome: 'secundario',
      status: 'secundario',
      valor: 'secundario',
      'id-segmento': 'secundario',
    });
    expect(dados).toMatchObject({ nome: 'Ana Souza', status: 'ganho', valor: VALOR_SECUNDARIO });
    expect(dados.customFields).toEqual({ 'id-segmento': 'industria', 'id-nota': NOTA });
  });

  it('tags: união; última interação: a mais recente', () => {
    const dados = montarMesclagem(PRINCIPAL, SECUNDARIO);
    expect(dados.tags).toEqual(['vip', 'b2b']);
    expect(dados.ultimaInteracaoEm).toEqual(new Date('2026-10-10T00:00:00Z'));
  });
});

describe('mesclarLeads', () => {
  it('o mesmo lead dos dois lados → 400', async () => {
    await expect(mesclarLeads('t', { principalId: 'a', secundarioId: 'a' })).rejects.toThrow('dois leads diferentes');
    expect(mesclarLeadsRepository).not.toHaveBeenCalled();
  });

  it('escolha do personalizado chega pela chave da API e vai pro repository pelo id', async () => {
    mesclarLeadsRepository.mockImplementationOnce(async (_tenant, _ids, { montar }) => montar(PRINCIPAL, SECUNDARIO));
    await mesclarLeads('t', { principalId: 'p', secundarioId: 's', escolhas: { segmento: 'secundario' } }, 'u-dono');

    const [, ids, opcoes] = mesclarLeadsRepository.mock.calls[0];
    expect(ids).toEqual({ principalId: 'p', secundarioId: 's' });
    expect(opcoes.autorId).toBe('u-dono');
    expect(opcoes.montar(PRINCIPAL, SECUNDARIO).customFields['id-segmento']).toBe('industria');
  });

  it('algum dos dois inexistente ou na lixeira → 404', async () => {
    mesclarLeadsRepository.mockResolvedValueOnce(undefined);
    await expect(mesclarLeads('t', { principalId: 'p', secundarioId: 's' })).rejects.toThrow('Lead não encontrado');
  });
});
