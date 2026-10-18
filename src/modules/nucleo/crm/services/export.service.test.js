import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { exportarLeads, valorParaPlanilha } from './export.service.js';
import { lerPlanilha } from './planilha.service.js';
import { buscarLeadsFiltrados, listarCamposDoTenant } from './leads.service.js';
import { featureAtiva, garantirFeature } from '#core/tenant/feature-flags.js';
import { obterLayout } from './layout.service.js';
import { listarUsuariosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import { CAMADA } from '../constants.js';

vi.mock('./leads.service.js', () => ({
  buscarLeadsFiltrados: vi.fn(),
  listarCamposDoTenant: vi.fn(),
}));
vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn(), garantirFeature: vi.fn() }));
vi.mock('./layout.service.js', () => ({ obterLayout: vi.fn() }));
vi.mock('../adapters/usuarios.repository.js', () => ({ listarUsuariosAtivosDoTenant: vi.fn() }));

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
  featureAtiva.mockResolvedValue(true);
  garantirFeature.mockResolvedValue(undefined);
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

describe('exportarLeads — M10 (CSV e colunas padrão)', () => {
  const USUARIO = '00000000-0000-0000-0000-0000000000aa';
  const VALOR_CSV = 1234.5;
  const BOM = 0xfeff;

  it('sem colunas: as da tabela do usuário (identificador + colunas do layout), com responsável e data de criação', async () => {
    obterLayout.mockResolvedValue({
      efetivo: {
        identificador: { ref: 'f-nome', chave: 'nome' },
        colunas: [{ ref: 'lead.responsavel', chave: 'usuarioResponsavelId' }, { ref: 'lead.criadoEm', chave: 'createdAt' }],
      },
    });
    listarUsuariosAtivosDoTenant.mockResolvedValue([{ id: USUARIO, nome: 'Bia' }]);
    buscarLeadsFiltrados.mockResolvedValue({
      total: 1,
      itens: [{ nome: 'Ana', usuario_responsavel_id: USUARIO, created_at: new Date('2026-10-18T12:00:00Z') }],
    });

    const { colunas, linhas } = await lerPlanilha(await exportarLeads(TENANT, {}, USUARIO));

    expect(colunas).toEqual(['Nome', 'Responsável', 'Criado em']);
    expect(linhas[0].valores).toMatchObject({ Nome: 'Ana', 'Responsável': 'Bia' });
    expect(obterLayout).toHaveBeenCalledWith(TENANT, USUARIO);
  });

  it('sem colunas e sem crm.massa: continua obrigatório escolher', async () => {
    featureAtiva.mockResolvedValue(false);
    await expect(exportarLeads(TENANT, {}, USUARIO)).rejects.toMatchObject({ fields: { colunas: [expect.any(String)] } });
  });

  it('csv pro Excel pt-BR: BOM, ; , vírgula decimal, aspas e sem fórmula', async () => {
    buscarLeadsFiltrados.mockResolvedValue({
      total: 1,
      itens: [{ nome: 'João; "Jota"', valor: VALOR_CSV, tags: ['=cmd'], custom_fields: { vip: false } }],
    });

    const buffer = await exportarLeads(TENANT, { colunas: ['nome', 'valor', 'tags', 'vip'], formato: 'csv' }, USUARIO);
    const texto = buffer.toString('utf8');

    expect(garantirFeature).toHaveBeenCalledWith(TENANT, 'crm.massa');
    expect(texto.charCodeAt(0)).toBe(BOM);
    expect(texto.slice(1)).toBe('Nome;Valor;Tags;VIP\r\n"João; ""Jota""";1234,5;\'=cmd;Não\r\n');
  });

  it('csv com crm.massa desligada → o erro da flag', async () => {
    garantirFeature.mockRejectedValue(new Error('FEATURE_NOT_ENABLED'));
    await expect(exportarLeads(TENANT, { colunas: ['nome'], formato: 'csv' }, USUARIO)).rejects.toThrow('FEATURE_NOT_ENABLED');
    expect(buscarLeadsFiltrados).not.toHaveBeenCalled();
  });
});
