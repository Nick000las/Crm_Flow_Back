import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registrarNovoLead,
  buscarLeadFormatado,
  atualizarLeadExistente,
  pesquisarLeads,
  listarCamposDoTenant,
} from './leads.service.js';
import { listarDefinicoesPorTenant } from './field-definitions.service.js';
import {
  buscarLeadPorId,
  buscarLeadsComFiltro,
  criarLead,
  atualizarLead,
} from '../adapters/leads.repository.js';
import { CAMADA, CRM_FEATURES } from '../constants.js';
import { featureAtiva, garantirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { buscarCandidatos, buscarRegras } from '../adapters/crm-duplicates.repository.js';
import { buscarUsuarioAtivoDoTenant, listarUsuariosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import { agendarEnriquecimento } from './cnpj.service.js';
import { carregarContextoDistribuicao, distribuir, notificarAtribuicao } from './distribuicao.service.js';
import { emTodosOsContextos, montarCampos, obterSchemaCampos } from './field-schema.service.js';

// Layout (M4): tenant que nunca configurou (identificador = Nome).
// M14: a pontuação tem teste próprio; aqui ela não grava nada.
vi.mock('./score.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recalcularScoreDosLeads: vi.fn().mockResolvedValue(null),
  garantirScoreNaoEditado: vi.fn(),
}));
vi.mock('../adapters/crm-layout.repository.js', () => ({ buscarLayoutPadrao: vi.fn().mockResolvedValue(undefined) }));
// M15: tenant sem base legal padrão e nenhum lead anonimizado (o bloco do M15 troca).
vi.mock('../adapters/crm-lgpd.repository.js', () => ({
  buscarConfigLgpd: vi.fn().mockResolvedValue(undefined),
  buscarSituacaoLgpd: vi.fn().mockResolvedValue(undefined),
}));
// Listas (M3): tenant já semeado com as keys antigas.
vi.mock('../adapters/crm-options.repository.js', async () => (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes());
vi.mock('../adapters/usuarios.repository.js', () => ({ buscarUsuarioAtivoDoTenant: vi.fn(), listarUsuariosAtivosDoTenant: vi.fn() }));
// Arquivo (M5) ligado; os testes de situação estão em arquivo.service.test.js.
// Flags: todas ligadas, menos `crm.duplicidade` e `crm.inatividade`
// (testadas nos blocos do M7 e do M9).
vi.mock('#core/tenant/feature-flags.js', () => ({
  featureAtiva: vi.fn(async (_tenant, chave) => !['crm.duplicidade', 'crm.inatividade'].includes(chave)),
  garantirFeature: vi.fn(),
}));
// M11b: o enriquecimento tem teste próprio; aqui só o gancho depois de salvar.
vi.mock('./cnpj.service.js', () => ({ agendarEnriquecimento: vi.fn().mockResolvedValue(0) }));
// M12: o motor e a config têm teste próprio; aqui, desligada por padrão (o bloco do M12 liga).
vi.mock('./distribuicao.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  carregarContextoDistribuicao: vi.fn().mockResolvedValue(null),
  distribuir: vi.fn(),
  notificarAtribuicao: vi.fn().mockResolvedValue(1),
}));
vi.mock('../adapters/crm-duplicates.repository.js', () => ({ buscarRegras: vi.fn(), buscarCandidatos: vi.fn() }));

// Configuração da Camada 2 que o resolver devolveria (`visibilidade`); cada
// teste define a sua. Default: nenhuma coluna de Camada 2 configurada.
const { listarVisibilidadeDoTenant, regrasDoTeste } = vi.hoisted(() => ({
  listarVisibilidadeDoTenant: vi.fn(),
  // Regras do M8 que o schema devolve (resolvidas); cada bloco define as suas.
  regrasDoTeste: { valor: [] },
}));


// O service lê o schema do resolver; aqui ele é montado com as funções
// reais a partir dos mocks de visibilidade/definições abaixo — os testes
// continuam controlando a configuração por eles.
vi.mock('./field-schema.service.js', async (importOriginal) => {
  const real = await importOriginal();
  const { listarDefinicoesPorTenant: definicoes } = await import('./field-definitions.service.js');
  return {
    ...real,
    obterSchemaCampos: vi.fn(async (tenantId) => {
      const [vis, defs] = await Promise.all([listarVisibilidadeDoTenant(tenantId), definicoes(tenantId)]);
      const { opcoesSemeadas } = await import('../testing/listas.fixture.js');
      const listas = real.agruparPorLista(opcoesSemeadas());
      return {
        visibilidade: vis,
        definicoes: defs,
        listas,
        campos: real.montarCampos(vis, defs, {}, listas),
        regras: regrasDoTeste.valor,
      };
    }),
  };
});

vi.mock('../adapters/leads.repository.js', () => ({
  buscarLeadPorId: vi.fn(),
  buscarLeadsComFiltro: vi.fn(),
  criarLead: vi.fn().mockResolvedValue({ id: 'lead-123' }),
  atualizarLead: vi.fn(),
}));

// `leads.service.js` importa `field-definitions.service.js` direto (mesmo
// módulo, import relativo) — mockado aqui, não o adapter dele, porque o
// que o service de leads chama é `listarDefinicoesPorTenant`.
vi.mock('./field-definitions.service.js', () => ({
  listarDefinicoesPorTenant: vi.fn().mockResolvedValue([]),
}));

const ID_ORIGEM = '11111111-1111-1111-1111-111111111111';
const ID_PRIORIDADE = '22222222-2222-2222-2222-222222222222';
const ID_CELULAR = '33333333-3333-3333-3333-333333333333';

const CAMPO_TEXTO = {
  id: ID_ORIGEM,
  chave: 'origem',
  label: 'Origem',
  tipo: 'texto',
  opcoes: null,
  obrigatorio: false,
};

const CAMPO_SELECAO_OBRIGATORIO = {
  id: ID_PRIORIDADE,
  chave: 'prioridade',
  label: 'Prioridade',
  tipo: 'selecao',
  opcoes: ['alta', 'media', 'baixa'],
  obrigatorio: true,
};

// Sem isso, chamadas de `it`s anteriores continuam contadas nos `expect(...
// ).toHaveBeenCalled()` seguintes — `mockResolvedValue` do factory de
// `vi.mock` sobrevive ao clear, só o histórico de chamadas é zerado.
beforeEach(() => {
  vi.clearAllMocks();
  criarLead.mockResolvedValue({ id: 'lead-123' });
  listarDefinicoesPorTenant.mockResolvedValue([]);
  listarVisibilidadeDoTenant.mockResolvedValue([]);
});

describe('registrarNovoLead', () => {
  it('rejeita nome vazio antes de chamar o adapter', async () => {
    await expect(
      registrarNovoLead('tenant-1', { nome: '  ', telefone: '11999999999', funilEstagioId: 'x' }),
    ).rejects.toThrow('Nome do lead não pode ser vazio');
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('cria lead sem custom fields quando não há definições', async () => {
    const resultado = await registrarNovoLead('tenant-1', {
      nome: 'João',
      telefone: '11999999999',
      funilEstagioId: 'estagio-1',
    });
    expect(resultado).toEqual({ id: 'lead-123' });
  });

  it('rejeita chave de custom field desconhecida', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_TEXTO]);
    await expect(
      registrarNovoLead('tenant-1', {
        nome: 'João',
        telefone: '11999999999',
        funilEstagioId: 'estagio-1',
        customFields: { chave_que_nao_existe: 'valor' },
      }),
    ).rejects.toThrow(/desconhecido/);
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('rejeita quando falta um custom field obrigatório na criação', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_SELECAO_OBRIGATORIO]);
    await expect(
      registrarNovoLead('tenant-1', {
        nome: 'João',
        telefone: '11999999999',
        funilEstagioId: 'estagio-1',
      }),
    ).rejects.toThrow(/Prioridade/);
  });

  it('rejeita valor de seleção fora das opções cadastradas', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_SELECAO_OBRIGATORIO]);
    await expect(
      registrarNovoLead('tenant-1', {
        nome: 'João',
        telefone: '11999999999',
        funilEstagioId: 'estagio-1',
        customFields: { prioridade: 'urgente' },
      }),
    ).rejects.toThrow(/Prioridade/);
  });

  it('cria lead com custom fields válidos, passando objeto puro (sem stringificar) pro adapter', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_SELECAO_OBRIGATORIO]);
    await registrarNovoLead('tenant-1', {
      nome: 'João',
      telefone: '11999999999',
      funilEstagioId: 'estagio-1',
      customFields: { prioridade: 'alta' },
    });
    expect(criarLead).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ customFields: { [ID_PRIORIDADE]: 'alta' } }),
      { autorId: null }, // evento "criado" do histórico (M6)
    );
  });
});

describe('buscarLeadFormatado', () => {
  it('lança 404 quando o lead não existe', async () => {
    buscarLeadPorId.mockResolvedValueOnce(undefined);
    await expect(buscarLeadFormatado('tenant-1', 'lead-x')).rejects.toThrow('Lead não encontrado');
  });

  it('formata o telefone do lead encontrado', async () => {
    buscarLeadPorId.mockResolvedValueOnce({ id: 'lead-1', telefone: '11999999999' });
    const lead = await buscarLeadFormatado('tenant-1', 'lead-1');
    expect(lead.telefone).not.toBe('11999999999'); // formatarTelefoneBR aplicado
  });
});

describe('atualizarLeadExistente', () => {
  it('rejeita nome vazio quando o campo é enviado', async () => {
    await expect(
      atualizarLeadExistente('tenant-1', 'lead-1', { nome: '   ' }),
    ).rejects.toThrow('Nome do lead não pode ser vazio');
    expect(atualizarLead).not.toHaveBeenCalled();
  });

  it('lança 404 quando o UPDATE não encontra a linha (id errado ou de outro tenant)', async () => {
    atualizarLead.mockResolvedValueOnce(undefined);
    await expect(
      atualizarLeadExistente('tenant-1', 'lead-x', { nome: 'Novo nome' }),
    ).rejects.toThrow('Lead não encontrado');
  });

  it('não exige custom field obrigatório numa edição parcial', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_SELECAO_OBRIGATORIO]);
    atualizarLead.mockResolvedValueOnce({ id: 'lead-1', telefone: '11999999999' });
    await expect(
      atualizarLeadExistente('tenant-1', 'lead-1', { nome: 'Novo nome' }),
    ).resolves.toMatchObject({ id: 'lead-1' });
  });
});

describe('pesquisarLeads', () => {
  const PAGINA = 2;
  const TAMANHO = 10;
  const TOTAL = 11;

  it('traduz o filtro, pagina e remove Camada 2 desligada do resultado', async () => {
    listarVisibilidadeDoTenant.mockResolvedValue([
      { coluna: 'cpf', visivel: false, ordem: 0, obrigatorio: false },
      { coluna: 'empresa', visivel: true, ordem: 0, obrigatorio: false },
    ]);
    buscarLeadsComFiltro.mockResolvedValue({
      total: TOTAL,
      itens: [{ id: 'lead-1', nome: 'Ana', telefone: null, cpf: '123', empresa: 'ACME' }],
    });

    const resultado = await pesquisarLeads('tenant-1', {
      filtros: [{ chave: 'empresa', operador: 'contem', valor: 'AC' }],
      paginacao: { pagina: PAGINA, tamanho: TAMANHO },
    });

    const [, condicoes, paginacao] = buscarLeadsComFiltro.mock.calls[0];
    // 1ª condição é a situação (M5); o filtro vem depois.
    expect(condicoes[0].sql).toContain('l.deleted_at IS NULL');
    expect(condicoes[1].sql).toContain('l.empresa ILIKE');
    expect(paginacao).toEqual({ limite: TAMANHO, offset: TAMANHO, inatividade: null });
    expect(resultado).toMatchObject({ total: TOTAL, pagina: PAGINA, tamanho: TAMANHO });
    expect(resultado.itens[0]).not.toHaveProperty('cpf');
    expect(resultado.itens[0].empresa).toBe('ACME');
  });

  it('não deixa filtrar por coluna de Camada 2 desligada', async () => {
    listarVisibilidadeDoTenant.mockResolvedValue([{ coluna: 'cpf', visivel: false, ordem: 0, obrigatorio: false }]);
    await expect(
      pesquisarLeads('tenant-1', {
        filtros: [{ chave: 'cpf', operador: 'igual', valor: '123' }],
        paginacao: { pagina: 1, tamanho: TAMANHO },
      }),
    ).rejects.toThrow('"cpf" não é um campo ativo para filtro');
    expect(buscarLeadsComFiltro).not.toHaveBeenCalled();
  });
});

describe('situação na busca (M5)', () => {
  const TAMANHO_PAGINA = 20;
  const PRIMEIRA_PAGINA = { pagina: 1, tamanho: TAMANHO_PAGINA };

  beforeEach(() => {
    listarVisibilidadeDoTenant.mockResolvedValue([]);
    buscarLeadsComFiltro.mockResolvedValue({ total: 0, itens: [] });
  });

  it('sem crm.arquivo, pedir arquivados ou lixeira é 403 (garantirFeature)', async () => {
    featureAtiva.mockResolvedValueOnce(false);
    garantirFeature.mockRejectedValueOnce(new Error('FEATURE_NOT_ENABLED'));
    await expect(
      pesquisarLeads('tenant-1', { situacao: 'lixeira', paginacao: PRIMEIRA_PAGINA }),
    ).rejects.toThrow('FEATURE_NOT_ENABLED');
    expect(garantirFeature).toHaveBeenCalledWith('tenant-1', CRM_FEATURES.ARQUIVO);
    expect(buscarLeadsComFiltro).not.toHaveBeenCalled();
  });

  it('lead da lixeira volta com purga_em (30 dias depois da exclusão)', async () => {
    buscarLeadsComFiltro.mockResolvedValueOnce({
      total: 1,
      itens: [{ id: 'lead-1', nome: 'Ana', telefone: null, deleted_at: new Date('2026-10-01T00:00:00Z') }],
    });
    const { itens } = await pesquisarLeads('tenant-1', { situacao: 'lixeira', paginacao: PRIMEIRA_PAGINA });
    expect(itens[0].purga_em).toEqual(new Date('2026-10-31T00:00:00Z'));
  });
});

describe('listarCamposDoTenant', () => {
  it('junta as 3 camadas, só com Camada 2 visível', async () => {
    listarVisibilidadeDoTenant.mockResolvedValue([
      { coluna: 'cpf', visivel: false, ordem: 0, obrigatorio: false },
      { coluna: 'empresa', visivel: true, ordem: 0, obrigatorio: true },
    ]);
    listarDefinicoesPorTenant.mockResolvedValue([CAMPO_TEXTO]);

    const campos = await listarCamposDoTenant('tenant-1');
    const porChave = Object.fromEntries(campos.map((campo) => [campo.chave, campo]));

    expect(porChave.nome.camada).toBe(CAMADA.CAMADA_1);
    expect(porChave.fonteLead.coluna).toBe('fonte_lead');
    expect(porChave.empresa).toMatchObject({
      camada: CAMADA.CAMADA_2,
      coluna: 'empresa',
      obrigatorio: true,
      label: 'Empresa',
    });
    expect(porChave.origem).not.toHaveProperty('coluna');
    expect(porChave.cpf).toBeUndefined();
    expect(porChave.origem.camada).toBe(CAMADA.CAMADA_3);
  });
});

describe('responsável pelo lead', () => {
  const NOVO_LEAD = { nome: 'Ana', email: 'ana@x.com', funilEstagioId: 'estagio-1' };

  it('sem responsável informado, o criador vira o responsável', async () => {
    await registrarNovoLead('tenant-1', NOVO_LEAD, 'usuario-criador');
    expect(criarLead.mock.calls[0][1].usuarioResponsavelId).toBe('usuario-criador');
    expect(buscarUsuarioAtivoDoTenant).not.toHaveBeenCalled();
  });

  it('responsável de outro tenant (ou inativo) é rejeitado', async () => {
    buscarUsuarioAtivoDoTenant.mockResolvedValue(undefined);
    await expect(
      registrarNovoLead('tenant-1', { ...NOVO_LEAD, usuarioResponsavelId: 'usuario-de-fora' }, 'usuario-criador'),
    ).rejects.toThrow('Responsável inválido');
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('responsável válido do tenant é aceito na edição', async () => {
    buscarUsuarioAtivoDoTenant.mockResolvedValue({ id: 'usuario-2' });
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null });
    await atualizarLeadExistente('tenant-1', 'lead-1', { usuarioResponsavelId: 'usuario-2' });
    expect(atualizarLead).toHaveBeenCalledWith(
      'tenant-1',
      'lead-1',
      { usuarioResponsavelId: 'usuario-2' },
      expect.objectContaining({ autorId: null, montarDiff: expect.any(Function) }),
      { inatividade: null },
    );
  });
});

describe('edição limpando campos (null)', () => {
  it('não deixa limpar o e-mail quando o lead não tem telefone', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', email: 'ana@x.com', telefone: null });
    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { email: null })).rejects.toThrow(
      'O lead precisa manter e-mail ou telefone',
    );
    expect(atualizarLead).not.toHaveBeenCalled();
  });

  it('deixa limpar o e-mail quando o telefone continua', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', email: 'ana@x.com', telefone: '11999999999' });
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', email: null, telefone: '11999999999' });
    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { email: null })).resolves.toMatchObject({
      email: null,
    });
  });

  it('não busca o lead atual quando nada de contato é limpo', async () => {
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Bia', telefone: null, cargo: 'Gerente' });
    // `nome` não: mudar o nome lê o lead pra decidir o primeiro nome (M10).
    await atualizarLeadExistente('tenant-1', 'lead-1', { cargo: 'Gerente' });
    expect(buscarLeadPorId).not.toHaveBeenCalled();
  });

  it('não deixa limpar campo obrigatório de Camada 2 visível', async () => {
    listarVisibilidadeDoTenant.mockResolvedValue([{ coluna: 'empresa', visivel: true, ordem: 0, obrigatorio: true }]);
    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { empresa: null })).rejects.toThrow(
      '"Empresa" é obrigatório e não pode ser limpo',
    );
  });

  it('não deixa remover campo customizado obrigatório', async () => {
    listarDefinicoesPorTenant.mockResolvedValue([CAMPO_SELECAO_OBRIGATORIO]);
    await expect(
      atualizarLeadExistente('tenant-1', 'lead-1', { customFields: { prioridade: null } }),
    ).rejects.toThrow('"Prioridade" é obrigatório e não pode ser limpo');
  });

  it('deixa remover campo customizado opcional', async () => {
    listarDefinicoesPorTenant.mockResolvedValue([CAMPO_TEXTO]);
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null, custom_fields: {} });
    await atualizarLeadExistente('tenant-1', 'lead-1', { customFields: { origem: null } });
    expect(atualizarLead).toHaveBeenCalled();
  });
});

describe('custom_fields gravado por id, API por chave', () => {
  it('criar troca a chave pelo id do campo', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_TEXTO]);
    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', customFields: { origem: 'site' } });
    expect(criarLead.mock.calls[0][1].customFields).toEqual({ [ID_ORIGEM]: 'site' });
  });

  it('limpar (null) vai pelo id', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_TEXTO]);
    atualizarLead.mockResolvedValueOnce({ id: 'lead-1', telefone: null, custom_fields: {} });

    await atualizarLeadExistente('tenant-1', 'lead-1', { customFields: { origem: null } });

    expect(atualizarLead.mock.calls[0][2].customFields).toEqual({ [ID_ORIGEM]: null });
  });

  it('a leitura devolve por chave, só com campos ativos', async () => {
    listarDefinicoesPorTenant.mockResolvedValueOnce([CAMPO_TEXTO]);
    buscarLeadPorId.mockResolvedValueOnce({
      id: 'lead-1',
      telefone: null,
      custom_fields: { [ID_ORIGEM]: 'site', 'campo-excluido': 'x' },
    });

    const lead = await buscarLeadFormatado('tenant-1', 'lead-1');
    expect(lead.custom_fields).toEqual({ origem: 'site' });
  });
});

describe('M2 — obrigatoriedade configurada e tipos novos', () => {
  /** Schema com `status` marcado obrigatório pelo tenant. */
  function schemaComStatusObrigatorio(criacaoVisivel = true) {
    const visibilidade = { ...emTodosOsContextos(true), create_form: criacaoVisivel };
    const sobreposicoes = { status: { obrigatorio: true, visibilidade } };
    return { visibilidade: [], definicoes: [], campos: montarCampos([], [], sobreposicoes) };
  }

  it('status obrigatório (Camada 1) é exigido na criação', async () => {
    obterSchemaCampos.mockResolvedValueOnce(schemaComStatusObrigatorio());
    await expect(
      registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999' }),
    ).rejects.toMatchObject({ fields: { status: [expect.stringContaining('obrigatório')] } });
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('obrigatório fora do formulário de criação não trava o cadastro', async () => {
    obterSchemaCampos.mockResolvedValueOnce(schemaComStatusObrigatorio(false));
    await expect(registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999' })).resolves.toEqual({
      id: 'lead-123',
    });
  });

  it('status obrigatório não pode ser limpo na edição', async () => {
    obterSchemaCampos.mockResolvedValueOnce(schemaComStatusObrigatorio());
    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { status: null })).rejects.toThrow(
      /não pode ser limpo/,
    );
  });

  it('telefone personalizado é validado e gravado só com dígitos', async () => {
    const celular = { id: ID_CELULAR, chave: 'celular', label: 'Celular', tipo: 'telefone', opcoes: null, obrigatorio: false };
    listarDefinicoesPorTenant.mockResolvedValueOnce([celular]);
    await registrarNovoLead('tenant-1', {
      nome: 'Ana',
      telefone: '11999999999',
      customFields: { celular: '(11) 98888-7777' },
    });
    expect(criarLead.mock.calls[0][1].customFields).toEqual({ [ID_CELULAR]: '11988887777' });

    listarDefinicoesPorTenant.mockResolvedValueOnce([celular]);
    await expect(
      registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', customFields: { celular: '12' } }),
    ).rejects.toThrow(/Valor inválido/);
  });
});

describe('campo oculto em todos os contextos não sai na resposta', () => {
  const LEAD_GRAVADO = {
    id: 'lead-1',
    nome: 'Ana',
    telefone: null,
    fonte_lead: 'whatsapp',
    tags: ['vip'],
    custom_fields: { [ID_ORIGEM]: 'site' },
  };

  /** @param {Record<string, import('./field-schema.service.js').Sobreposicao>} sobreposicoes */
  function schema(sobreposicoes) {
    return { visibilidade: [], definicoes: [CAMPO_TEXTO], campos: montarCampos([], [CAMPO_TEXTO], sobreposicoes) };
  }

  it('Camada 1 ocultável e personalizado desligados somem do lead', async () => {
    buscarLeadPorId.mockResolvedValueOnce(LEAD_GRAVADO);
    obterSchemaCampos.mockResolvedValueOnce(
      schema({ fonteLead: { visibilidade: emTodosOsContextos(false) }, origem: { visibilidade: emTodosOsContextos(false) } }),
    );

    const lead = await buscarLeadFormatado('tenant-1', 'lead-1');

    expect(lead).not.toHaveProperty('fonte_lead');
    expect(lead.tags).toEqual(['vip']);
    expect(lead.custom_fields).toEqual({});
  });

  it('oculto só em um contexto (tabela) continua na resposta', async () => {
    buscarLeadPorId.mockResolvedValueOnce(LEAD_GRAVADO);
    const soForaDaTabela = { visibilidade: { ...emTodosOsContextos(true), table: false } };
    obterSchemaCampos.mockResolvedValueOnce(schema({ fonteLead: soForaDaTabela, origem: soForaDaTabela }));

    const lead = await buscarLeadFormatado('tenant-1', 'lead-1');

    expect(lead.fonte_lead).toBe('whatsapp');
    expect(lead.custom_fields).toEqual({ origem: 'site' });
  });
});

describe('e-mail e telefone nativos na forma canônica', () => {
  it('criar grava telefone só com dígitos (sem DDI) e e-mail minúsculo', async () => {
    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '+55 (11) 98888-7777', email: ' Ana@X.com ' });
    expect(criarLead.mock.calls[0][1]).toMatchObject({ telefone: '11988887777', email: 'ana@x.com' });
  });

  it('telefone que não é BR válido é rejeitado', async () => {
    await expect(registrarNovoLead('tenant-1', { nome: 'Ana', telefone: 'abcdefghijk' })).rejects.toMatchObject({
      fields: { telefone: [expect.stringContaining('DDD')] },
    });
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('editar normaliza também; null (limpar) passa direto', async () => {
    atualizarLead.mockResolvedValueOnce({ id: 'lead-1', telefone: '11988887777' });
    await atualizarLeadExistente('tenant-1', 'lead-1', { telefone: '(11) 98888-7777' });
    expect(atualizarLead.mock.calls[0][2].telefone).toBe('11988887777');

    buscarLeadPorId.mockResolvedValueOnce({ id: 'lead-1', email: 'a@x.com', telefone: '11988887777' });
    atualizarLead.mockResolvedValueOnce({ id: 'lead-1', telefone: null });
    await atualizarLeadExistente('tenant-1', 'lead-1', { telefone: null });
    expect(atualizarLead.mock.calls[1][2].telefone).toBeNull();
  });
});

describe('listas configuráveis (M3)', () => {
  it('status fora da lista do tenant → 400, sem gravar', async () => {
    await expect(
      registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', status: 'inventado' }),
    ).rejects.toMatchObject({ fields: { status: [expect.stringContaining('não é uma opção')] } });
    expect(criarLead).not.toHaveBeenCalled();
  });

  it('tag nova é criada na lista e o lead grava a key', async () => {
    const { inserirOpcoes } = await import('../adapters/crm-options.repository.js');
    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', tags: ['Feira 2026'] });

    expect(inserirOpcoes).toHaveBeenCalledWith('tenant-1', 'tag', [
      expect.objectContaining({ key: 'feira_2026', label: 'Feira 2026' }),
    ]);
    expect(criarLead.mock.calls[0][1].tags).toEqual(['feira_2026']);
  });
});

describe('duplicidade no formulário (M7)', () => {
  const ANA = { id: 'lead-ana', nome: 'Ana', campos: ['email'] };

  beforeEach(() => {
    vi.clearAllMocks();
    listarVisibilidadeDoTenant.mockResolvedValue([]);
    featureAtiva.mockImplementation(async () => true);
    buscarRegras.mockResolvedValue([]);
    buscarCandidatos.mockResolvedValue([ANA]);
  });

  afterEach(() => {
    featureAtiva.mockImplementation(async (_tenant, chave) => !['crm.duplicidade', 'crm.inatividade'].includes(chave));
  });

  it('criar com parecido: 409 DUPLICATE_WARNING; confirmando, salva', async () => {
    await expect(registrarNovoLead('tenant-1', { nome: 'Ana', email: 'ana@x.com' })).rejects.toMatchObject({
      code: 'DUPLICATE_WARNING',
    });
    expect(criarLead).not.toHaveBeenCalled();

    await registrarNovoLead('tenant-1', { nome: 'Ana', email: 'ana@x.com', ignorarDuplicados: true });
    expect(criarLead).toHaveBeenCalledTimes(1);
    expect(criarLead.mock.calls[0][1]).not.toHaveProperty('ignorarDuplicados');
  });

  it('editar sem mudar e-mail (só a caixa) não checa; mudar checa sem contar o próprio lead', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', email: 'ana@x.com', telefone: null });
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null });

    await atualizarLeadExistente('tenant-1', 'lead-1', { email: 'ANA@x.com' });
    expect(buscarCandidatos).not.toHaveBeenCalled();

    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { email: 'bia@x.com' })).rejects.toMatchObject({
      code: 'DUPLICATE_WARNING',
    });
    expect(buscarCandidatos).toHaveBeenCalledWith('tenant-1', { email: 'bia@x.com' }, 'lead-1');
  });
});

describe('regras de obrigatoriedade (M8)', () => {
  const MOTIVO = { id: 'f-motivo', chave: 'motivoPerda', label: 'Motivo da perda', tipo: 'selecao', camada: CAMADA.CAMADA_2 };
  const REGRA_MOTIVO = {
    id: 'r-motivo',
    kind: 'required_from_status',
    ativo: true,
    sistema: true,
    alvo: MOTIVO,
    condicao: { categorias: ['perdido'] },
    efeito: { obrigatorio: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Motivo da perda (Camada 2) ligado — sem isso a regra nem resolveria.
    listarVisibilidadeDoTenant.mockResolvedValue([{ coluna: 'motivo_perda', visivel: true, ordem: 0, obrigatorio: false }]);
    regrasDoTeste.valor = [REGRA_MOTIVO];
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null });
  });

  afterEach(() => {
    regrasDoTeste.valor = [];
  });

  it('edição parcial que só muda o status pra perdido, num lead sem motivo → 400 em motivoPerda', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', nome: 'Ana', email: 'ana@x.com', status: 'novo', motivo_perda: null });
    await expect(atualizarLeadExistente('tenant-1', 'lead-1', { status: 'perdido' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { motivoPerda: ['"Motivo da perda" é obrigatório quando o status é perdido'] },
    });
    expect(atualizarLead).not.toHaveBeenCalled();
  });

  it('com o motivo no payload, ou já no lead, passa', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', nome: 'Ana', email: 'ana@x.com', status: 'novo', motivo_perda: null });
    await atualizarLeadExistente('tenant-1', 'lead-1', { status: 'perdido', motivoPerda: 'preco' });

    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', nome: 'Ana', email: 'ana@x.com', status: 'novo', motivo_perda: 'preco' });
    await atualizarLeadExistente('tenant-1', 'lead-1', { status: 'perdido' });
    expect(atualizarLead).toHaveBeenCalledTimes(['payload', 'lead'].length);
  });

  it('criar já perdido sem motivo → 400; com a flag desligada, passa', async () => {
    await expect(registrarNovoLead('tenant-1', { nome: 'Ana', email: 'ana@x.com', status: 'perdido' })).rejects.toThrow(
      'Motivo da perda',
    );

    featureAtiva.mockImplementation(async (_tenant, chave) => chave !== 'crm.regras' && chave !== 'crm.duplicidade');
    await expect(registrarNovoLead('tenant-1', { nome: 'Ana', email: 'ana@x.com', status: 'perdido' })).resolves.toBeDefined();
    featureAtiva.mockImplementation(async (_tenant, chave) => !['crm.duplicidade', 'crm.inatividade'].includes(chave));
  });
});

describe('lead esfriando (M9)', () => {
  const TAMANHO_PAGINA = 10;
  const PAGINACAO = { pagina: 1, tamanho: TAMANHO_PAGINA };

  beforeEach(() => {
    vi.clearAllMocks();
    listarVisibilidadeDoTenant.mockResolvedValue([]);
    featureAtiva.mockImplementation(async (_tenant, chave) => chave !== 'crm.duplicidade');
    buscarLeadsComFiltro.mockResolvedValue({ total: 0, itens: [] });
  });

  afterEach(() => {
    featureAtiva.mockImplementation(async (_tenant, chave) => !['crm.duplicidade', 'crm.inatividade'].includes(chave));
  });

  it('com a flag, a busca lê com o relógio e o filtro "esfriando" vira condição', async () => {
    await pesquisarLeads('tenant-1', { esfriando: true, filtros: [], paginacao: PAGINACAO });

    const [, condicoes, opcoes] = buscarLeadsComFiltro.mock.calls[0];
    expect(opcoes.inatividade).toBeInstanceOf(Date);
    expect(condicoes.at(-1).sql).toContain('make_interval(days => o.stale_days)');
    expect(garantirFeature).not.toHaveBeenCalled();
  });

  it('sem a flag, nada é calculado; pedir "esfriando" confere a flag (403)', async () => {
    featureAtiva.mockImplementation(async (_tenant, chave) => !['crm.duplicidade', 'crm.inatividade'].includes(chave));
    await pesquisarLeads('tenant-1', { filtros: [], paginacao: PAGINACAO });
    expect(buscarLeadsComFiltro.mock.calls[0][2].inatividade).toBeNull();

    garantirFeature.mockRejectedValueOnce(new Error('403'));
    await expect(
      pesquisarLeads('tenant-1', { esfriando: true, filtros: [], paginacao: PAGINACAO }),
    ).rejects.toThrow('403');
    expect(garantirFeature).toHaveBeenCalledWith('tenant-1', CRM_FEATURES.INATIVIDADE);
  });

  it('o detalhe e a edição também leem com o relógio', async () => {
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null, esfriando_desde: null });
    await buscarLeadFormatado('tenant-1', 'lead-1');
    expect(buscarLeadPorId).toHaveBeenCalledWith('tenant-1', 'lead-1', { inatividade: expect.any(Date) });

    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', telefone: null });
    await atualizarLeadExistente('tenant-1', 'lead-1', { nome: 'Ana B' });
    expect(atualizarLead.mock.calls[0][4]).toEqual({ inatividade: expect.any(Date) });
  });
});

describe('tipos do M11 no formulário', () => {
  const ID_CONSULTOR = '44444444-4444-4444-4444-444444444444';
  const USUARIO_ATIVO = '00000000-0000-0000-0000-0000000000aa';
  const CONSULTAS_DE_USUARIOS = 2; // uma por chamada (a recusada e a aceita)
  const CAMPO_USUARIO = { id: ID_CONSULTOR, chave: 'consultor', label: 'Consultor', tipo: 'usuario', opcoes: null, obrigatorio: false };

  it('CPF/CNPJ/CEP nativos: inválido → 400 no campo; válido vai gravado sem máscara', async () => {
    await expect(
      registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', cpf: '529.982.247-24' }),
    ).rejects.toMatchObject({ fields: { cpf: [expect.any(String)] } });

    await registrarNovoLead('tenant-1', {
      nome: 'Ana',
      telefone: '11999999999',
      cpf: '529.982.247-25',
      cnpj: '12.abc.345/01de-35',
      cep: '01310-100',
    });
    expect(criarLead.mock.calls[0][1]).toMatchObject({ cpf: '52998224725', cnpj: '12ABC34501DE35', cep: '01310100' });
  });

  it('personalizado "usuario" tem que ser usuário ativo do tenant (uma consulta só)', async () => {
    listarDefinicoesPorTenant.mockResolvedValue([CAMPO_USUARIO]);
    listarUsuariosAtivosDoTenant.mockResolvedValue([{ id: USUARIO_ATIVO, nome: 'Bia' }]);

    await expect(
      registrarNovoLead('tenant-1', {
        nome: 'Ana',
        telefone: '11999999999',
        customFields: { consultor: '00000000-0000-0000-0000-0000000000bb' },
      }),
    ).rejects.toThrow('"Consultor" precisa ser um usuário ativo desta conta');

    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', customFields: { consultor: USUARIO_ATIVO } });
    expect(listarUsuariosAtivosDoTenant).toHaveBeenCalledTimes(CONSULTAS_DE_USUARIOS);
    expect(criarLead).toHaveBeenCalledTimes(1);
  });

  it('sem campo "usuario" no payload, não consulta os usuários', async () => {
    listarDefinicoesPorTenant.mockResolvedValue([CAMPO_USUARIO]);
    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999' });
    expect(listarUsuariosAtivosDoTenant).not.toHaveBeenCalled();
  });
});

describe('enriquecimento por CNPJ depois de salvar (M11b)', () => {
  it('criação agenda com o id do lead novo; PUT só quando mexe no CNPJ', async () => {
    await registrarNovoLead('tenant-1', { nome: 'Ana', telefone: '11999999999', cnpj: '11.222.333/0001-81' });
    expect(agendarEnriquecimento).toHaveBeenCalledWith('tenant-1', [{ leadId: 'lead-123', cnpj: '11222333000181' }]);

    vi.clearAllMocks();
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Ana', cnpj: '11222333000181' });
    await atualizarLeadExistente('tenant-1', 'lead-1', { cargo: 'Gerente' });
    expect(agendarEnriquecimento).not.toHaveBeenCalled();

    await atualizarLeadExistente('tenant-1', 'lead-1', { cnpj: '11.222.333/0001-81' });
    expect(agendarEnriquecimento).toHaveBeenCalledWith('tenant-1', [{ leadId: 'lead-1', cnpj: '11222333000181' }]);
  });
});

describe('distribuição automática (M12)', () => {
  const LEAD = { nome: 'Bia', email: 'bia@x.com', funilEstagioId: 'estagio-1' };
  const CONTEXTO = { fallback: 'rodizio_geral', regras: [], campos: [], ativos: new Set(), rodizioGeral: [], membrosPorGrupo: new Map() };
  const PELA_REGRA = { usuarioId: 'usuario-vendas', regraId: 'regra-1', regraNome: 'Site', origem: 'regra' };

  beforeEach(() => {
    carregarContextoDistribuicao.mockResolvedValue(CONTEXTO);
    distribuir.mockResolvedValue(PELA_REGRA);
  });

  it('sem responsável no payload: distribui, grava a regra e o rastro no histórico, e notifica', async () => {
    await registrarNovoLead('tenant-1', LEAD, 'usuario-criador');
    const [, dados, historico] = criarLead.mock.calls[0];
    expect(dados).toMatchObject({ usuarioResponsavelId: 'usuario-vendas', atribuidoPorRegraId: 'regra-1' });
    expect(historico).toEqual({
      autorId: 'usuario-criador',
      detalhes: { distribuicao: { origem: 'regra', regraId: 'regra-1', regraNome: 'Site' } },
    });
    expect(notificarAtribuicao).toHaveBeenCalledWith('tenant-1', {
      leadId: 'lead-123',
      leadNome: 'Bia',
      atribuicao: PELA_REGRA,
      criadorId: 'usuario-criador',
    });
  });

  it('responsável escolhido (mesmo o próprio criador) não é redistribuído', async () => {
    await registrarNovoLead('tenant-1', { ...LEAD, usuarioResponsavelId: 'usuario-criador' }, 'usuario-criador');
    expect(carregarContextoDistribuicao).not.toHaveBeenCalled();
    expect(distribuir).not.toHaveBeenCalled();
    expect(criarLead.mock.calls[0][1]).toMatchObject({ usuarioResponsavelId: 'usuario-criador', atribuidoPorRegraId: null });
  });

  it('fallback "sem responsável" grava o lead sem dono (não cai no criador)', async () => {
    distribuir.mockResolvedValue({ usuarioId: null, regraId: null, regraNome: null, origem: 'sem_responsavel' });
    await registrarNovoLead('tenant-1', LEAD, 'usuario-criador');
    expect(criarLead.mock.calls[0][1].usuarioResponsavelId).toBeNull();
  });

  it('desligada (contexto nulo): o criador continua sendo o responsável, sem detalhes no evento', async () => {
    carregarContextoDistribuicao.mockResolvedValue(null);
    await registrarNovoLead('tenant-1', LEAD, 'usuario-criador');
    expect(distribuir).not.toHaveBeenCalled();
    expect(criarLead.mock.calls[0][1].usuarioResponsavelId).toBe('usuario-criador');
    expect(criarLead.mock.calls[0][2].detalhes).toBeUndefined();
    expect(notificarAtribuicao).not.toHaveBeenCalled();
  });
});
