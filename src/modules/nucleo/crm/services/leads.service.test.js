import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registrarNovoLead,
  buscarLeadFormatado,
  atualizarLeadExistente,
  excluirLead,
  pesquisarLeads,
  listarCamposDoTenant,
} from './leads.service.js';
import { listarDefinicoesPorTenant } from './field-definitions.service.js';
import { listarVisibilidadeDoTenant } from './field-visibility.service.js';
import {
  buscarLeadPorId,
  buscarLeadsComFiltro,
  criarLead,
  atualizarLead,
  removerLead,
} from '../adapters/leads.repository.js';
import { CAMADA } from '../constants.js';
import { buscarUsuarioAtivoDoTenant } from '../adapters/usuarios.repository.js';

vi.mock('../adapters/usuarios.repository.js', () => ({ buscarUsuarioAtivoDoTenant: vi.fn() }));

vi.mock('../adapters/leads.repository.js', () => ({
  buscarLeadPorId: vi.fn(),
  buscarLeadsComFiltro: vi.fn(),
  criarLead: vi.fn().mockResolvedValue({ id: 'lead-123' }),
  atualizarLead: vi.fn(),
  removerLead: vi.fn(),
}));

// `leads.service.js` importa `field-definitions.service.js` direto (mesmo
// módulo, import relativo) — mockado aqui, não o adapter dele, porque o
// que o service de leads chama é `listarDefinicoesPorTenant`.
vi.mock('./field-definitions.service.js', () => ({
  listarDefinicoesPorTenant: vi.fn().mockResolvedValue([]),
}));

// Mesmo racional acima, pra `listarVisibilidadeDoTenant` (usada na
// validação de obrigatoriedade de Camada 2 e no filtro de visibilidade da
// leitura). Default: nenhuma coluna de Camada 2 configurada.
vi.mock('./field-visibility.service.js', () => ({
  listarVisibilidadeDoTenant: vi.fn().mockResolvedValue([]),
}));

const CAMPO_TEXTO = {
  chave: 'origem',
  label: 'Origem',
  tipo: 'texto',
  opcoes: null,
  obrigatorio: false,
};

const CAMPO_SELECAO_OBRIGATORIO = {
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
      expect.objectContaining({ customFields: { prioridade: 'alta' } }),
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

describe('excluirLead', () => {
  it('lança 404 quando o DELETE não encontra a linha', async () => {
    removerLead.mockResolvedValueOnce(undefined);
    await expect(excluirLead('tenant-1', 'lead-x')).rejects.toThrow('Lead não encontrado');
  });

  it('confirma remoção quando encontra', async () => {
    removerLead.mockResolvedValueOnce({ id: 'lead-1' });
    await expect(excluirLead('tenant-1', 'lead-1')).resolves.toEqual({ removido: true });
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
    expect(condicoes[0].sql).toContain('l.empresa ILIKE');
    expect(paginacao).toEqual({ limite: TAMANHO, offset: TAMANHO });
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
    expect(atualizarLead).toHaveBeenCalledWith('tenant-1', 'lead-1', { usuarioResponsavelId: 'usuario-2' });
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
    atualizarLead.mockResolvedValue({ id: 'lead-1', nome: 'Bia', telefone: null });
    await atualizarLeadExistente('tenant-1', 'lead-1', { nome: 'Bia' });
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
