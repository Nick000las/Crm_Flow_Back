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
  transicionarStatus,
  registrarProgresso,
  marcarFalha,
} from '../adapters/import-jobs.repository.js';
import { enfileirarImportacao } from '../adapters/import-queue.repository.js';
import { buscarLeadDuplicado, criarLead, atualizarLead } from '../adapters/leads.repository.js';
import { CAMADA } from '../constants.js';

vi.mock('./leads.service.js', () => ({ listarCamposDoTenant: vi.fn() }));
vi.mock('./field-schema.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  obterSchemaCampos: vi.fn().mockResolvedValue({ visibilidade: [], definicoes: [], campos: [] }),
}));
vi.mock('../adapters/funil-estagios.repository.js', () => ({ buscarEstagiosPorTenant: vi.fn() }));
vi.mock('../adapters/import-jobs.repository.js', () => ({
  criarImportJob: vi.fn(),
  buscarImportJob: vi.fn(),
  buscarImportJobComPayload: vi.fn(),
  transicionarStatus: vi.fn(),
  registrarProgresso: vi.fn(),
  marcarFalha: vi.fn(),
}));
vi.mock('../adapters/import-queue.repository.js', () => ({
  enfileirarImportacao: vi.fn(),
  encerrarFilaImportacao: vi.fn(),
}));
vi.mock('../adapters/leads.repository.js', () => ({
  buscarLeadDuplicado: vi.fn(),
  criarLead: vi.fn(),
  atualizarLead: vi.fn(),
}));

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
});

describe('validarImportacao', () => {
  it('converte linhas válidas, casa opção sem diferenciar maiúsculas e grava o job', async () => {
    const buffer = await planilha([['Ana', 'ANA@X.COM', null, 'GANHO', '25/12/2025', 'varejo', 'proposta']]);

    const resultado = await validarImportacao(TENANT, USUARIO, buffer, {
      mapeamento: MAPEAMENTO,
      estrategiaDuplicata: 'pular',
    });

    expect(resultado).toEqual({ jobId: JOB, totalLinhas: 1, linhasValidas: 1, erros: [] });
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
      payload: [LINHA],
    });
  }

  function progressoFinal() {
    return registrarProgresso.mock.calls.at(-1)[2];
  }

  it('pular: lead existente não é tocado', async () => {
    jobCom('pular');
    buscarLeadDuplicado.mockResolvedValue({ id: 'lead-1' });

    await processarImportacao(TENANT, JOB);

    expect(criarLead).not.toHaveBeenCalled();
    expect(atualizarLead).not.toHaveBeenCalled();
    expect(progressoFinal()).toMatchObject({ linhasIgnoradas: 1, statusFinal: 'concluido' });
  });

  it('atualizar: lead existente é atualizado sem mover de estágio', async () => {
    jobCom('atualizar');
    buscarLeadDuplicado.mockResolvedValue({ id: 'lead-1' });

    await processarImportacao(TENANT, JOB);

    const dados = atualizarLead.mock.calls[0][2];
    expect(atualizarLead.mock.calls[0][1]).toBe('lead-1');
    expect(dados.funilEstagioId).toBeUndefined();
    expect(dados.ultimaInteracaoEm).toBeInstanceOf(Date);
    expect(progressoFinal()).toMatchObject({ linhasAtualizadas: 1 });
  });

  it('criar: sempre cria, sem procurar duplicado, com estágio padrão', async () => {
    jobCom('criar');

    await processarImportacao(TENANT, JOB);

    expect(buscarLeadDuplicado).not.toHaveBeenCalled();
    expect(criarLead.mock.calls[0][1].funilEstagioId).toBe(ESTAGIO_NOVO);
    expect(progressoFinal()).toMatchObject({ linhasCriadas: 1 });
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
