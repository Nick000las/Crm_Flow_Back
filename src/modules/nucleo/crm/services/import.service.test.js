import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  converterLinha,
  previsualizarImportacao,
  validarImportacao,
  confirmarImportacao,
  processarImportacao,
} from './import.service.js';
import { gerarPlanilha } from './planilha.service.js';
import { listarCamposDoTenant } from './leads.service.js';
import { buscarEstagiosPorTenant } from '../adapters/funil-estagios.repository.js';
import {
  criarImportJob,
  buscarImportJob,
  buscarImportJobComPayload,
  definirAcoesDuplicata,
  transicionarStatus,
  registrarProgresso,
  marcarFalha,
} from '../adapters/import-jobs.repository.js';
import { enfileirarImportacao } from '../adapters/import-queue.repository.js';
import { criarLead, atualizarLead } from '../adapters/leads.repository.js';
import { duplicadosDasLinhas, encontrarDuplicados } from './duplicidade.service.js';
import { regrasAplicaveis } from './leads.service.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { CAMADA } from '../constants.js';
import { agendarEnriquecimento } from './cnpj.service.js';
import { carregarContextoDistribuicao, distribuir, notificarAtribuicoesDoImport } from './distribuicao.service.js';

// M11b: enriquecimento por CNPJ tem teste próprio; aqui só o gancho do lote.
vi.mock('./cnpj.service.js', () => ({ agendarEnriquecimento: vi.fn().mockResolvedValue(0) }));
// M12: distribuição desligada por padrão; o bloco do M12 liga.
vi.mock('./distribuicao.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  carregarContextoDistribuicao: vi.fn().mockResolvedValue(null),
  distribuir: vi.fn(),
  notificarAtribuicoesDoImport: vi.fn().mockResolvedValue(0),
}));

vi.mock('./leads.service.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    listarCamposDoTenant: vi.fn(),
    // Regras do M8: sem regra por padrão; os blocos do M8 trocam.
    regrasAplicaveis: vi.fn().mockResolvedValue([]),
    errosDasRegras: real.errosDasRegras,
    leadParaApi: real.leadParaApi,
    aplicarEdicao: real.aplicarEdicao,
  };
});
vi.mock('./field-schema.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  obterSchemaCampos: vi.fn().mockResolvedValue({ visibilidade: [], definicoes: [], campos: [] }),
}));
vi.mock('../adapters/funil-estagios.repository.js', () => ({ buscarEstagiosPorTenant: vi.fn() }));
vi.mock('../adapters/import-jobs.repository.js', () => ({
  criarImportJob: vi.fn(),
  buscarImportJob: vi.fn(),
  buscarImportJobComPayload: vi.fn(),
  definirAcoesDuplicata: vi.fn(),
  transicionarStatus: vi.fn(),
  registrarProgresso: vi.fn(),
  marcarFalha: vi.fn(),
}));
vi.mock('../adapters/import-queue.repository.js', () => ({
  enfileirarImportacao: vi.fn(),
  encerrarFilaImportacao: vi.fn(),
}));
vi.mock('../adapters/leads.repository.js', () => ({
  buscarLeadPorId: vi.fn(),
  criarLead: vi.fn(),
  atualizarLead: vi.fn(),
}));
// Duplicidade (M7): regras e busca têm teste próprio; aqui só o que o import faz com o resultado.
vi.mock('./duplicidade.service.js', () => ({
  regrasDoImport: vi.fn().mockResolvedValue([]),
  duplicadosDasLinhas: vi.fn().mockResolvedValue([]),
  encontrarDuplicados: vi.fn().mockResolvedValue([]),
}));

const DUPLICADO_AVISO = { id: 'lead-1', nome: 'Ana', campos: [{ campo: 'email', label: 'E-mail' }], acao: 'warn' };
const DUPLICADO_BLOQUEIO = { ...DUPLICADO_AVISO, acao: 'block' };

const TENANT = '00000000-0000-0000-0000-000000000001';
const USUARIO = '00000000-0000-0000-0000-000000000002';
const JOB = '00000000-0000-0000-0000-000000000003';
const ESTAGIO_NOVO = 'estagio-novo';
const ESTAGIO_PROPOSTA = 'estagio-proposta';
// Números de linha da planilha (linha 1 é o cabeçalho).
const LINHA_ANA = 2;
const LINHA_BIA = 3;
const LINHA_VAZIA = 4;

const CAMPOS = [
  { chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1, obrigatorio: true },
  { chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1, obrigatorio: false },
  { chave: 'telefone', label: 'Telefone', tipo: 'telefone', camada: CAMADA.CAMADA_1, obrigatorio: false },
  { chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1, obrigatorio: false, opcoes: ['novo', 'ganho'] },
  { chave: 'ultimaInteracaoEm', label: 'Última interação', tipo: 'data', camada: CAMADA.CAMADA_1, obrigatorio: false },
  { chave: 'segmento', label: 'Segmento', tipo: 'selecao', camada: CAMADA.CAMADA_3, obrigatorio: true, opcoes: ['Varejo', 'Indústria'] },
];

const MAPEAMENTO = {
  Nome: 'nome',
  Email: 'email',
  Fone: 'telefone',
  Situação: 'status',
  Contato: 'ultimaInteracaoEm',
  Segmento: 'segmento',
  Etapa: 'funilEstagio',
};

const CABECALHO = Object.keys(MAPEAMENTO);

function planilha(linhas) {
  return gerarPlanilha(CABECALHO, linhas);
}

beforeEach(() => {
  vi.clearAllMocks();
  listarCamposDoTenant.mockResolvedValue(CAMPOS);
  buscarEstagiosPorTenant.mockResolvedValue([
    { id: ESTAGIO_NOVO, nome: 'Novo' },
    { id: ESTAGIO_PROPOSTA, nome: 'Proposta' },
  ]);
  criarImportJob.mockResolvedValue({ id: JOB });
});

describe('previsualizarImportacao', () => {
  it('devolve cabeçalho, linhas e campos mapeáveis (inclui extras de planilha)', async () => {
    const buffer = await planilha([['Ana', 'ana@x.com', null, 'novo', null, 'Varejo', 'Novo']]);
    const resultado = await previsualizarImportacao(TENANT, buffer);

    expect(resultado.colunas).toEqual(CABECALHO);
    expect(resultado.totalLinhas).toBe(1);
    expect(resultado.linhas[0].Nome).toBe('Ana');
    expect(resultado.campos.map((campo) => campo.chave)).toContain('funilEstagio');
    expect(criarImportJob).not.toHaveBeenCalled();
  });

  // M10.4: o passo Mapear oferece os personalizados (Camada 3) como destino.
  it('campos mapeáveis incluem os personalizados', async () => {
    const buffer = await planilha([['Ana', 'ana@x.com', null, 'novo', null, 'Varejo', 'Novo']]);
    const { campos } = await previsualizarImportacao(TENANT, buffer);
    expect(campos).toContainEqual(expect.objectContaining({ chave: 'segmento', camada: CAMADA.CAMADA_3 }));
  });
});

describe('validarImportacao', () => {
  it('converte linhas válidas, casa opção sem diferenciar maiúsculas e grava o job', async () => {
    const buffer = await planilha([['Ana', 'ANA@X.COM', null, 'GANHO', '25/12/2025', 'varejo', 'proposta']]);

    const resultado = await validarImportacao(TENANT, USUARIO, buffer, {
      mapeamento: MAPEAMENTO,
      estrategiaDuplicata: 'pular',
    });

    expect(resultado).toEqual({ jobId: JOB, totalLinhas: 1, linhasValidas: 1, erros: [], duplicados: [] });
    const { payload } = criarImportJob.mock.calls[0][1];
    expect(payload[0].dados).toEqual({
      nome: 'Ana',
      email: 'ana@x.com',
      status: 'ganho',
      ultimaInteracaoEm: '2025-12-25T00:00:00.000Z',
      funilEstagioId: ESTAGIO_PROPOSTA,
      customFields: { segmento: 'Varejo' },
    });
  });

  it('acumula erros de todas as linhas sem gravar as inválidas', async () => {
    const buffer = await planilha([
      ['Ana', 'ana@x.com', null, 'novo', null, 'Varejo', null],
      ['Bia', 'email-ruim', null, 'talvez', '31/02/2025', 'Varejo', 'Inexistente'],
      [null, null, null, null, null, null, 'Novo'],
    ]);

    const resultado = await validarImportacao(TENANT, USUARIO, buffer, {
      mapeamento: MAPEAMENTO,
      estrategiaDuplicata: 'criar',
    });

    expect(resultado.linhasValidas).toBe(1);
    const motivosLinha3 = resultado.erros.filter((erro) => erro.linha === LINHA_BIA).map((erro) => erro.motivo);
    expect(motivosLinha3).toEqual(
      expect.arrayContaining([
        'E-mail inválido em "E-mail": "email-ruim"',
        '"talvez" não é uma opção de "Status"',
        '"Última interação" espera uma data (dd/mm/aaaa)',
        'Estágio "Inexistente" não existe no funil',
      ]),
    );
    const motivosLinha4 = resultado.erros.filter((erro) => erro.linha === LINHA_VAZIA).map((erro) => erro.motivo);
    expect(motivosLinha4).toEqual(
      expect.arrayContaining(['"Nome" é obrigatório', '"Segmento" é obrigatório', 'Informe e-mail ou telefone']),
    );
    expect(criarImportJob.mock.calls[0][1].payload).toHaveLength(1);
  });

  it('não cria job quando nenhuma linha é válida', async () => {
    const buffer = await planilha([['Ana', null, null, null, null, 'Varejo', null]]);
    const resultado = await validarImportacao(TENANT, USUARIO, buffer, {
      mapeamento: MAPEAMENTO,
      estrategiaDuplicata: 'criar',
    });
    expect(resultado.jobId).toBeNull();
    expect(criarImportJob).not.toHaveBeenCalled();
  });

  it('rejeita mapeamento com coluna inexistente, campo inativo ou obrigatório faltando', async () => {
    const buffer = await planilha([['Ana', 'ana@x.com', null, null, null, 'Varejo', null]]);
    await expect(
      validarImportacao(TENANT, USUARIO, buffer, {
        mapeamento: { Nome: 'nome', Email: 'email', Fantasma: 'cpf' },
        estrategiaDuplicata: 'criar',
      }),
    ).rejects.toMatchObject({
      fields: {
        mapeamento: expect.arrayContaining([
          'A coluna "Fantasma" não existe na planilha',
          '"cpf" não é um campo ativo',
          'O campo obrigatório "Segmento" não foi mapeado',
        ]),
      },
    });
  });
});

describe('confirmarImportacao', () => {
  it('enfileira o job pendente', async () => {
    transicionarStatus.mockResolvedValue(true);
    buscarImportJob.mockResolvedValue({ id: JOB, status: 'processando' });

    await expect(confirmarImportacao(TENANT, JOB)).resolves.toMatchObject({ status: 'processando' });
    expect(enfileirarImportacao).toHaveBeenCalledWith(TENANT, JOB);
  });

  it('job já confirmado → 409, sem enfileirar de novo', async () => {
    transicionarStatus.mockResolvedValue(false);
    buscarImportJob.mockResolvedValue({ id: JOB, status: 'processando' });

    await expect(confirmarImportacao(TENANT, JOB)).rejects.toThrow('Esta importação já foi confirmada');
    expect(enfileirarImportacao).not.toHaveBeenCalled();
  });

  it('fila indisponível → 503 e o job volta pra pendente', async () => {
    transicionarStatus.mockResolvedValue(true);
    enfileirarImportacao.mockRejectedValueOnce(new Error('REDIS_URL não configurado'));

    await expect(confirmarImportacao(TENANT, JOB)).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    expect(transicionarStatus).toHaveBeenLastCalledWith(TENANT, JOB, 'processando', 'pendente');
  });
});

describe('processarImportacao — estratégias de duplicata', () => {
  const LINHA = {
    linha: LINHA_ANA,
    dados: { nome: 'Ana', email: 'ana@x.com', ultimaInteracaoEm: '2025-12-25T00:00:00.000Z', customFields: {} },
  };

  function jobCom(estrategia) {
    buscarImportJobComPayload.mockResolvedValue({
      id: JOB,
      status: 'processando',
      estrategia_duplicata: estrategia,
      usuario_id: USUARIO,
      payload: [LINHA],
    });
  }

  function progressoFinal() {
    return registrarProgresso.mock.calls.at(-1)[2];
  }

  it('pular: lead existente não é tocado', async () => {
    jobCom('pular');
    encontrarDuplicados.mockResolvedValue([DUPLICADO_AVISO]);

    await processarImportacao(TENANT, JOB);

    expect(criarLead).not.toHaveBeenCalled();
    expect(atualizarLead).not.toHaveBeenCalled();
    expect(progressoFinal()).toMatchObject({ linhasIgnoradas: 1, statusFinal: 'concluido' });
  });

  it('atualizar: lead existente é atualizado sem mover de estágio, com histórico do importador', async () => {
    jobCom('atualizar');
    encontrarDuplicados.mockResolvedValue([DUPLICADO_AVISO]);
    // Primeiro nome editado à mão: o nome da planilha não o sobrescreve (M10).
    buscarLeadPorId.mockResolvedValueOnce({ id: 'lead-1', nome: 'Ana Souza', primeiro_nome: 'Aninha' });

    await processarImportacao(TENANT, JOB);

    const dados = atualizarLead.mock.calls[0][2];
    expect(atualizarLead.mock.calls[0][1]).toBe('lead-1');
    expect(dados.funilEstagioId).toBeUndefined();
    expect(dados.ultimaInteracaoEm).toBeInstanceOf(Date);
    expect(dados.primeiroNome).toBeUndefined();
    expect(atualizarLead.mock.calls[0][3]).toMatchObject({ autorId: USUARIO, montarDiff: expect.any(Function) });
    expect(progressoFinal()).toMatchObject({ linhasAtualizadas: 1 });
  });

  it('criar: cria mesmo com duplicado que só avisa, com estágio padrão e evento "criado"', async () => {
    jobCom('criar');
    encontrarDuplicados.mockResolvedValue([DUPLICADO_AVISO]);

    await processarImportacao(TENANT, JOB);

    expect(criarLead.mock.calls[0][1].funilEstagioId).toBe(ESTAGIO_NOVO);
    // M10: sem a coluna, o primeiro nome sai do nome.
    expect(criarLead.mock.calls[0][1].primeiroNome).toBe('Ana');
    expect(criarLead.mock.calls[0][2]).toEqual({ autorId: USUARIO });
    expect(progressoFinal()).toMatchObject({ linhasCriadas: 1 });
  });

  it('criar onde a regra bloqueia: linha ignorada com o motivo no relatório (M7)', async () => {
    jobCom('criar');
    encontrarDuplicados.mockResolvedValue([DUPLICADO_BLOQUEIO]);

    await processarImportacao(TENANT, JOB);

    expect(criarLead).not.toHaveBeenCalled();
    expect(progressoFinal()).toMatchObject({
      linhasIgnoradas: 1,
      relatorioErro: [{ linha: LINHA_ANA, motivo: expect.stringContaining('não deixa criar outro') }],
    });
  });

  it('a ação escolhida no Revisar vence a estratégia do job', async () => {
    buscarImportJobComPayload.mockResolvedValue({
      id: JOB,
      status: 'processando',
      estrategia_duplicata: 'pular',
      usuario_id: USUARIO,
      acoes: { [String(LINHA_ANA)]: 'atualizar' },
      payload: [LINHA],
    });
    encontrarDuplicados.mockResolvedValue([DUPLICADO_AVISO]);

    await processarImportacao(TENANT, JOB);

    expect(atualizarLead).toHaveBeenCalled();
    expect(progressoFinal()).toMatchObject({ linhasAtualizadas: 1 });
  });

  it('erro numa linha vai pro relatório sem derrubar o job', async () => {
    jobCom('criar');
    criarLead.mockRejectedValueOnce(new Error('violates check constraint "chk_x"'));

    await processarImportacao(TENANT, JOB);

    expect(progressoFinal()).toMatchObject({
      linhasComErro: 1,
      relatorioErro: [{ linha: LINHA_ANA, motivo: 'Não foi possível gravar esta linha' }],
      statusFinal: 'concluido',
    });
    expect(marcarFalha).not.toHaveBeenCalled();
  });

  it('job que não está processando é ignorado', async () => {
    buscarImportJobComPayload.mockResolvedValue({ id: JOB, status: 'concluido', payload: [LINHA] });
    await processarImportacao(TENANT, JOB);
    expect(criarLead).not.toHaveBeenCalled();
  });
});

describe('converterLinha — tipos MVP do M2', () => {
  const CAMPOS_M2 = [
    { chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1, obrigatorio: false },
    { chave: 'contrato', label: 'Contrato', tipo: 'monetario', camada: CAMADA.CAMADA_3, obrigatorio: false },
    { chave: 'celular', label: 'Celular', tipo: 'telefone', camada: CAMADA.CAMADA_3, obrigatorio: false },
    { chave: 'site', label: 'Site', tipo: 'url', camada: CAMADA.CAMADA_3, obrigatorio: false },
  ];
  const porChave = new Map(CAMPOS_M2.map((campo) => [campo.chave, campo]));
  const mapa = { Email: 'email', Contrato: 'contrato', Celular: 'celular', Site: 'site' };
  const VALOR_CONTRATO = 1234.56;

  it('converte e normaliza os tipos novos pro customFields', () => {
    const { dados, erros } = converterLinha(
      { numero: LINHA_ANA, valores: { Email: 'a@x.com', Contrato: 'R$ 1.234,56', Celular: '(11) 99999-0000', Site: 'https://x.com' } },
      mapa,
      CAMPOS_M2,
      porChave,
      new Map(),
    );
    expect(erros).toEqual([]);
    expect(dados.customFields).toEqual({ contrato: VALOR_CONTRATO, celular: '11999990000', site: 'https://x.com' });
  });

  it('valor inválido vira erro da linha no Revisar', () => {
    const { erros } = converterLinha(
      { numero: LINHA_BIA, valores: { Email: 'a@x.com', Contrato: 'caro', Celular: '12', Site: 'x' } },
      mapa,
      CAMPOS_M2,
      porChave,
      new Map(),
    );
    expect(erros.map((erro) => erro.coluna)).toEqual(['Contrato', 'Celular', 'Site']);
    expect(erros.every((erro) => erro.linha === LINHA_BIA)).toBe(true);
  });
});

describe('Revisar: duplicados no validate e ações no confirm (M7)', () => {
  const PAYLOAD = [
    { linha: LINHA_ANA, dados: { nome: 'Ana' }, duplicata: 'warn' },
    { linha: LINHA_BIA, dados: { nome: 'Bia' }, duplicata: 'block' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    buscarImportJobComPayload.mockResolvedValue({ id: JOB, status: 'pendente', payload: PAYLOAD });
    transicionarStatus.mockResolvedValue(true);
    buscarImportJob.mockResolvedValue({ id: JOB, status: 'processando' });
  });

  it('grava as ações das linhas apontadas e confirma', async () => {
    await confirmarImportacao(TENANT, JOB, { acoes: { [String(LINHA_ANA)]: 'criar', [String(LINHA_BIA)]: 'atualizar' } });
    expect(definirAcoesDuplicata).toHaveBeenCalledWith(TENANT, JOB, { [String(LINHA_ANA)]: 'criar', [String(LINHA_BIA)]: 'atualizar' });
    expect(enfileirarImportacao).toHaveBeenCalled();
  });

  it('"criar" onde a regra bloqueia, ou linha não apontada → 400, sem confirmar', async () => {
    await expect(confirmarImportacao(TENANT, JOB, { acoes: { [String(LINHA_BIA)]: 'criar' } })).rejects.toThrow(
      'não deixa criar outro',
    );
    await expect(confirmarImportacao(TENANT, JOB, { acoes: { [String(LINHA_VAZIA)]: 'pular' } })).rejects.toThrow(
      'não foi apontada como duplicada',
    );
    expect(transicionarStatus).not.toHaveBeenCalled();
  });

  it('sem ações, confirma como antes (sem ler o payload)', async () => {
    await confirmarImportacao(TENANT, JOB);
    expect(buscarImportJobComPayload).not.toHaveBeenCalled();
    expect(duplicadosDasLinhas).not.toHaveBeenCalled();
  });
});

describe('regras de obrigatoriedade no import (M8)', () => {
  const REGRA = {
    id: 'r1',
    kind: 'conditional',
    ativo: true,
    sistema: false,
    alvo: { id: 'f-cargo', chave: 'cargo', label: 'Cargo', tipo: 'texto', camada: CAMADA.CAMADA_2 },
    condicao: { campo: { id: 'f-nome', chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 }, operador: 'nao_vazio' },
    efeito: { obrigatorio: true, visivel: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validate: a linha que viola uma regra vai pros erros com o motivo, e não pro job', async () => {
    regrasAplicaveis.mockResolvedValueOnce([REGRA]);
    const buffer = await planilha([['Ana', 'ana@x.com', null, 'novo', null, 'Varejo', 'Novo']]);

    const resultado = await validarImportacao(TENANT, USUARIO, buffer, { mapeamento: MAPEAMENTO, estrategiaDuplicata: 'criar' });
    expect(resultado.jobId).toBeNull();
    expect(resultado.erros).toEqual([{ linha: LINHA_ANA, motivo: '"Cargo" é obrigatório por causa do valor de "Nome"' }]);
    expect(criarImportJob).not.toHaveBeenCalled();
  });

  it('worker: atualizar que deixaria o lead violando a regra → linha com erro, nada gravado', async () => {
    regrasAplicaveis.mockResolvedValueOnce([REGRA]);
    buscarImportJobComPayload.mockResolvedValue({
      id: JOB,
      status: 'processando',
      estrategia_duplicata: 'atualizar',
      usuario_id: USUARIO,
      acoes: {},
      payload: [{ linha: LINHA_ANA, dados: { nome: 'Ana' } }],
    });
    encontrarDuplicados.mockResolvedValue([{ id: 'lead-1', nome: 'Ana', campos: [], acao: 'warn' }]);
    buscarLeadPorId.mockResolvedValue({ id: 'lead-1', nome: 'Ana', cargo: null, custom_fields: {} });

    await processarImportacao(TENANT, JOB);

    expect(atualizarLead).not.toHaveBeenCalled();
    expect(registrarProgresso.mock.calls.at(-1)[2]).toMatchObject({
      linhasComErro: 1,
      relatorioErro: [{ linha: LINHA_ANA, motivo: expect.stringContaining('"Cargo" é obrigatório') }],
    });
  });
});

describe('enriquecimento por CNPJ no fim do lote (M11b)', () => {
  it('uma leva só, com os leads gravados que têm CNPJ', async () => {
    buscarImportJobComPayload.mockResolvedValue({
      id: JOB,
      status: 'processando',
      estrategia_duplicata: 'criar',
      usuario_id: USUARIO,
      payload: [
        { linha: LINHA_ANA, dados: { nome: 'Ana', email: 'ana@x.com', cnpj: '11222333000181', customFields: {} } },
        { linha: LINHA_BIA, dados: { nome: 'Bia', email: 'bia@x.com', customFields: {} } },
      ],
    });
    encontrarDuplicados.mockResolvedValue([]);
    criarLead.mockResolvedValueOnce({ id: 'lead-ana' }).mockResolvedValueOnce({ id: 'lead-bia' });

    await processarImportacao(TENANT, JOB);

    expect(agendarEnriquecimento).toHaveBeenCalledTimes(1);
    expect(agendarEnriquecimento).toHaveBeenCalledWith(TENANT, [{ leadId: 'lead-ana', cnpj: '11222333000181' }]);
  });
});

describe('distribuição automática no import (M12)', () => {
  const VENDEDORES = ['vendedor-a', 'vendedor-b', 'vendedor-c'];
  const LINHAS_DISTRIBUIDAS = 6;
  const POR_VENDEDOR = LINHAS_DISTRIBUIDAS / VENDEDORES.length;
  const CONTEXTO = { fallback: 'rodizio_geral', regras: [], campos: [], ativos: new Set(), rodizioGeral: [], membrosPorGrupo: new Map() };

  beforeEach(() => {
    carregarContextoDistribuicao.mockResolvedValue(CONTEXTO);
    let vez = 0;
    distribuir.mockImplementation(async () => {
      const usuarioId = VENDEDORES[vez % VENDEDORES.length];
      vez += 1;
      return { usuarioId, regraId: 'regra-1', regraNome: 'Todos', origem: 'regra' };
    });
    encontrarDuplicados.mockResolvedValue([]);
    criarLead.mockImplementation(async () => ({ id: 'lead' }));
  });

  function jobComLinhas(linhas) {
    buscarImportJobComPayload.mockResolvedValue({
      id: JOB,
      status: 'processando',
      estrategia_duplicata: 'criar',
      usuario_id: USUARIO,
      payload: linhas,
    });
  }

  it('cada lead novo passa pelo rodízio: 6 linhas com 3 vendedores, 2 pra cada, e uma notificação por pessoa', async () => {
    jobComLinhas(
      Array.from({ length: LINHAS_DISTRIBUIDAS }, (_, i) => ({
        linha: LINHA_ANA + i,
        dados: { nome: `Lead ${i}`, email: `l${i}@x.com`, customFields: {} },
      })),
    );

    await processarImportacao(TENANT, JOB);

    const responsaveis = criarLead.mock.calls.map(([, dados]) => dados.usuarioResponsavelId);
    for (const vendedor of VENDEDORES) {
      expect(responsaveis.filter((id) => id === vendedor)).toHaveLength(POR_VENDEDOR);
    }
    expect(criarLead.mock.calls[0][1].atribuidoPorRegraId).toBe('regra-1');
    expect(criarLead.mock.calls[0][2]).toEqual({
      autorId: USUARIO,
      detalhes: { distribuicao: { origem: 'regra', regraId: 'regra-1', regraNome: 'Todos' } },
    });
    expect(notificarAtribuicoesDoImport).toHaveBeenCalledWith(TENANT, {
      importJobId: JOB,
      totais: new Map(VENDEDORES.map((vendedor) => [vendedor, POR_VENDEDOR])),
      importadorId: USUARIO,
    });
  });

  it('linha com a coluna Responsável fica com ele (sem passar pelo rodízio)', async () => {
    jobComLinhas([{ linha: LINHA_ANA, dados: { nome: 'Ana', email: 'ana@x.com', usuarioResponsavelId: 'gerente', customFields: {} } }]);

    await processarImportacao(TENANT, JOB);

    expect(distribuir).not.toHaveBeenCalled();
    expect(criarLead.mock.calls[0][1]).toMatchObject({ usuarioResponsavelId: 'gerente', atribuidoPorRegraId: null });
  });

  it('desligada: quem importou continua sendo o responsável', async () => {
    carregarContextoDistribuicao.mockResolvedValue(null);
    jobComLinhas([{ linha: LINHA_ANA, dados: { nome: 'Ana', email: 'ana@x.com', customFields: {} } }]);

    await processarImportacao(TENANT, JOB);

    expect(distribuir).not.toHaveBeenCalled();
    expect(criarLead.mock.calls[0][1].usuarioResponsavelId).toBe(USUARIO);
  });
});
