import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { exportarLeads, valorParaPlanilha } from './export.service.js';
import { lerPlanilha } from './planilha.service.js';
import { buscarLeadsFiltrados, listarCamposDoTenant } from './leads.service.js';
import { CAMADA } from '../constants.js';

vi.mock('./leads.service.js', () => ({
  buscarLeadsFiltrados: vi.fn(),
  listarCamposDoTenant: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const VALOR_LEAD = 1500.5;
const MUITOS_LEADS = 10_001;

const CAMPOS = [
  { chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', camada: CAMADA.CAMADA_1 },
  { chave: 'segmento', label: 'Segmento', tipo: 'selecao', camada: CAMADA.CAMADA_3 },
  { chave: 'vip', label: 'VIP', tipo: 'booleano', camada: CAMADA.CAMADA_3 },
];

beforeEach(() => {
  vi.clearAllMocks();
  listarCamposDoTenant.mockResolvedValue(CAMPOS);
});

describe('exportarLeads', () => {
  it('gera xlsx só com as colunas pedidas, na ordem pedida, com rótulos', async () => {
    buscarLeadsFiltrados.mockResolvedValue({
      total: 1,
      itens: [
        {
          nome: 'Ana',
          tags: ['vip', 'b2b'],
          valor: new Prisma.Decimal(VALOR_LEAD),
          estagio_nome: 'Proposta',
          custom_fields: { segmento: 'Varejo', vip: true },
        },
      ],
    });

    const buffer = await exportarLeads(TENANT, {
      colunas: ['segmento', 'nome', 'tags', 'valor', 'funilEstagio', 'vip'],
    });
    const { colunas, linhas } = await lerPlanilha(buffer);

    expect(colunas).toEqual(['Segmento', 'Nome', 'Tags', 'Valor', 'Estágio do funil', 'VIP']);
    expect(linhas[0].valores).toEqual({
      Segmento: 'Varejo',
      Nome: 'Ana',
      Tags: 'vip, b2b',
      Valor: VALOR_LEAD,
      'Estágio do funil': 'Proposta',
      VIP: 'Sim',
    });
  });

  it('rejeita coluna que não é campo ativo (ex: Camada 2 desligada)', async () => {
    await expect(exportarLeads(TENANT, { colunas: ['nome', 'cpf'] })).rejects.toMatchObject({
      fields: { colunas: ['"cpf" não é um campo ativo'] },
    });
    expect(buscarLeadsFiltrados).not.toHaveBeenCalled();
  });

  it('rejeita export acima do limite de linhas', async () => {
    buscarLeadsFiltrados.mockResolvedValue({ total: MUITOS_LEADS, itens: [] });
    await expect(exportarLeads(TENANT, { colunas: ['nome'] })).rejects.toThrow('Refine o filtro');
  });
});

describe('valorParaPlanilha — tipos MVP do M2', () => {
  const VALOR = 99.9;

  it('telefone sai com máscara; monetário sai como número', () => {
    const lead = { custom_fields: { celular: '11999990000', contrato: VALOR } };
    expect(
      valorParaPlanilha(lead, { chave: 'celular', label: 'Celular', tipo: 'telefone', camada: CAMADA.CAMADA_3 }),
    ).toBe('(11) 99999-0000');
    expect(
      valorParaPlanilha(lead, { chave: 'contrato', label: 'Contrato', tipo: 'monetario', camada: CAMADA.CAMADA_3 }),
    ).toBe(VALOR);
  });
});

describe('valorParaPlanilha — campo de lista (M3)', () => {
  it('sai o nome da opção, não a key (lista e tags)', () => {
    const lead = { status: 'ganho', tags: ['vip', 'sumiu'] };
    const status = { chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1, opcoesLista: [{ key: 'ganho', label: 'Fechou' }] };
    const tags = { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', camada: CAMADA.CAMADA_1, opcoesLista: [{ key: 'vip', label: 'Cliente VIP' }] };

    expect(valorParaPlanilha(lead, status)).toBe('Fechou');
    expect(valorParaPlanilha(lead, tags)).toBe('Cliente VIP, sumiu');
  });
});
