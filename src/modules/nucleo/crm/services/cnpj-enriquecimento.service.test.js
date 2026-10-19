import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { atualizarLead, buscarLeadPorId } from '../adapters/leads.repository.js';
import { converterRespostaBrasilApi, provedorBrasilApi } from '../adapters/cnpj-brasilapi.provider.js';
import { CAMADA, ENRIQUECIMENTO_CNPJ } from '../constants.js';
import { consultarCnpj, obterConfigCnpj } from './cnpj.service.js';
import { encontrarDuplicados } from './duplicidade.service.js';
import { dadosParaGravar, filtrarSobrescrita, opcoesDoWorkerCnpj, processarEnriquecimento } from './cnpj-enriquecimento.service.js';

vi.mock('./duplicidade.service.js', () => ({ encontrarDuplicados: vi.fn().mockResolvedValue([]) }));

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('../adapters/leads.repository.js', () => ({ buscarLeadPorId: vi.fn(), atualizarLead: vi.fn() }));
vi.mock('./cnpj.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  consultarCnpj: vi.fn(),
  obterConfigCnpj: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000011';
const CNPJ = '11222333000181';
const ID_EMPRESA = '00000000-0000-0000-0000-00000000e001';
const ID_CIDADE = '00000000-0000-0000-0000-00000000e002';
const CNAE_SOFTWARE = 6201501;

const CAMPOS = [
  { id: ID_EMPRESA, chave: 'empresa', label: 'Empresa', tipo: 'texto', camada: CAMADA.CAMADA_2, coluna: 'empresa' },
  { id: ID_CIDADE, chave: 'cidade', label: 'Cidade', tipo: 'texto', camada: CAMADA.CAMADA_2, coluna: 'cidade' },
];
vi.mock('./field-schema.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  obterSchemaCampos: vi.fn(async () => ({ campos: CAMPOS, definicoes: [] })),
}));

const CONFIG = { ativo: true, modo: 'automatico', sobrescrever: false, mapeamento: { razaoSocial: ID_EMPRESA, municipio: ID_CIDADE } };

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  obterConfigCnpj.mockResolvedValue(CONFIG);
  // Empresa já preenchida à mão; cidade vazia.
  buscarLeadPorId.mockResolvedValue({ id: LEAD, cnpj: '11.222.333/0001-81', empresa: 'Acme (nome comercial)', cidade: null });
  consultarCnpj.mockResolvedValue({ cnpj: CNPJ, status: 'ok', provedor: 'brasilapi', dados: { razaoSocial: 'ACME LTDA', municipio: 'RECIFE' } });
});

describe('processarEnriquecimento (job do worker)', () => {
  it('sem sobrescrever: só preenche o vazio, como o sistema (autor nulo), evento "enriquecido"', async () => {
    const resultado = await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ });

    expect(resultado).toEqual({ resultado: 'enriquecido', campos: ['cidade'] });
    const [, , dados, historico] = atualizarLead.mock.calls[0];
    expect(dados).toEqual({ cidade: 'RECIFE' });
    expect(historico).toMatchObject({ autorId: null, tipo: 'enriquecido', detalhes: { cnpj: CNPJ, provedor: 'brasilapi' } });
  });

  it('com sobrescrever: aplica tudo do mapeamento', async () => {
    obterConfigCnpj.mockResolvedValue({ ...CONFIG, sobrescrever: true });
    await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ });
    expect(atualizarLead.mock.calls[0][2]).toEqual({ empresa: 'ACME LTDA', cidade: 'RECIFE' });
  });

  it('confere tudo de novo na hora do job: flag, modo, lead e CNPJ', async () => {
    featureAtiva.mockResolvedValueOnce(false);
    expect(await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).toEqual({ resultado: 'flag_desligada' });

    obterConfigCnpj.mockResolvedValueOnce({ ...CONFIG, modo: 'manual' });
    expect((await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).resultado).toBe('modo_manual');

    buscarLeadPorId.mockResolvedValueOnce({ id: LEAD, cnpj: '00000000000191' });
    expect((await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).resultado).toBe('lead_mudou');

    expect(consultarCnpj).not.toHaveBeenCalled();
    expect(atualizarLead).not.toHaveBeenCalled();
  });

  it('erro transitório do provedor sobe pra fila tentar de novo; o lead fica como estava', async () => {
    consultarCnpj.mockRejectedValue(Object.assign(new Error('BrasilAPI respondeu 429'), { transitorio: true }));
    await expect(processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).rejects.toThrow('429');
    expect(atualizarLead).not.toHaveBeenCalled();
  });

  it('nada vazio pra preencher: não grava', async () => {
    buscarLeadPorId.mockResolvedValue({ id: LEAD, cnpj: CNPJ, empresa: 'X', cidade: 'Y' });
    expect((await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).resultado).toBe('nada_a_preencher');
    expect(atualizarLead).not.toHaveBeenCalled();
  });
});

describe('filtrarSobrescrita', () => {
  it('olha o campo personalizado em customFields', () => {
    const sugestao = [{ chave: 'site', camada: CAMADA.CAMADA_3, valor: 'x' }];
    expect(filtrarSobrescrita(sugestao, { customFields: { site: 'y' } }, false)).toEqual([]);
    expect(filtrarSobrescrita(sugestao, { customFields: {} }, false)).toEqual(sugestao);
  });
});

describe('rate limit do worker', () => {
  const MAX_ENV = 10;
  const JANELA_ENV = 60_000;

  it('padrão do módulo, ou o do env', () => {
    expect(opcoesDoWorkerCnpj({})).toEqual({
      concurrency: 1,
      limiter: { max: ENRIQUECIMENTO_CNPJ.LIMITE_MAX, duration: ENRIQUECIMENTO_CNPJ.LIMITE_JANELA_MS },
    });
    expect(opcoesDoWorkerCnpj({ CNPJ_LIMITE_MAX: MAX_ENV, CNPJ_LIMITE_JANELA_MS: JANELA_ENV }).limiter).toEqual({
      max: MAX_ENV,
      duration: JANELA_ENV,
    });
  });
});

describe('provedor BrasilAPI', () => {
  const fetchFalso = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchFalso));
  afterEach(() => vi.unstubAllGlobals());

  const respostaHttp = (status, corpo = {}) => ({ status, ok: status < HTTP_STATUS.BAD_REQUEST, json: async () => corpo });

  it('converte a resposta pro formato do CRM', async () => {
    fetchFalso.mockResolvedValue(
      respostaHttp(HTTP_STATUS.OK, {
        razao_social: 'ACME LTDA',
        descricao_tipo_de_logradouro: 'RUA',
        logradouro: 'DAS FLORES',
        numero: '10',
        municipio: 'RECIFE',
        uf: 'PE',
        cep: '50000000',
        email: 'CONTATO@ACME.COM',
        cnae_fiscal: CNAE_SOFTWARE,
        cnae_fiscal_descricao: 'Desenvolvimento de software',
        nome_fantasia: '',
      }),
    );
    const { status, dados } = await provedorBrasilApi.consultar(CNPJ);
    expect(status).toBe('ok');
    expect(dados).toEqual({
      razaoSocial: 'ACME LTDA',
      logradouro: 'RUA DAS FLORES',
      numero: '10',
      municipio: 'RECIFE',
      uf: 'PE',
      cep: '50000000',
      email: 'contato@acme.com',
      cnae: '6201501 - Desenvolvimento de software',
    });
    expect(fetchFalso.mock.calls[0][0]).toBe(`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`);
  });

  it('404 → não encontrado; 429 e 5xx → erro transitório (a fila tenta de novo)', async () => {
    fetchFalso.mockResolvedValueOnce(respostaHttp(HTTP_STATUS.NOT_FOUND));
    expect((await provedorBrasilApi.consultar(CNPJ)).status).toBe('nao_encontrado');

    fetchFalso.mockResolvedValueOnce(respostaHttp(HTTP_STATUS.TOO_MANY_REQUESTS));
    await expect(provedorBrasilApi.consultar(CNPJ)).rejects.toMatchObject({ transitorio: true });

    fetchFalso.mockRejectedValueOnce(new Error('timeout'));
    await expect(provedorBrasilApi.consultar(CNPJ)).rejects.toMatchObject({ transitorio: true });
  });

  it('CNPJ alfanumérico: "não suportado", sem chamar a API', async () => {
    expect((await provedorBrasilApi.consultar('12ABC34501DE35')).status).toBe('nao_suportado');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('logradouro que já traz o tipo não repete', () => {
    expect(converterRespostaBrasilApi({ descricao_tipo_de_logradouro: 'RUA', logradouro: 'RUA X' }).logradouro).toBe('RUA X');
  });
});

describe('revisão da M11b', () => {
  const ID_EMAIL = '00000000-0000-0000-0000-00000000e003';

  it('data nativa vai como Date (o Postgres recusa texto em TIMESTAMP); personalizada fica ISO', () => {
    const dados = dadosParaGravar(
      [
        { chave: 'dataConversao', tipo: 'data', camada: CAMADA.CAMADA_2, valor: '2010-05-12' },
        { chave: 'fundacao', tipo: 'data', camada: CAMADA.CAMADA_3, valor: '2010-05-12' },
      ],
      [{ id: 'def-fundacao', chave: 'fundacao' }],
    );
    expect(dados.dataConversao).toEqual(new Date('2010-05-12'));
    expect(dados.customFields).toEqual({ 'def-fundacao': '2010-05-12' });
  });

  it('e-mail que bate num bloqueio de duplicidade (M7) fica de fora; o resto é gravado', async () => {
    obterConfigCnpj.mockResolvedValue({ ...CONFIG, mapeamento: { ...CONFIG.mapeamento, email: ID_EMAIL } });
    CAMPOS.push({ id: ID_EMAIL, chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1, coluna: 'email' });
    consultarCnpj.mockResolvedValue({
      cnpj: CNPJ,
      status: 'ok',
      provedor: 'brasilapi',
      dados: { municipio: 'RECIFE', email: 'contato@acme.com' },
    });
    try {
      encontrarDuplicados.mockResolvedValueOnce([{ id: 'outro', nome: 'Outro', campos: [{ campo: 'email' }], acao: 'block' }]);
      await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ });
      expect(encontrarDuplicados).toHaveBeenCalledWith(TENANT, { email: 'contato@acme.com' }, { ignorarId: LEAD });
      expect(atualizarLead.mock.calls[0][2]).toEqual({ cidade: 'RECIFE' });

      // Só avisar: o sistema não tem como confirmar, então grava.
      encontrarDuplicados.mockResolvedValueOnce([{ id: 'outro', nome: 'Outro', campos: [{ campo: 'email' }], acao: 'warn' }]);
      await processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ });
      expect(atualizarLead.mock.calls[1][2]).toEqual({ cidade: 'RECIFE', email: 'contato@acme.com' });
    } finally {
      CAMPOS.pop();
    }
  });

  it('erro que não é transitório não é repetido pela fila (UnrecoverableError)', async () => {
    consultarCnpj.mockRejectedValue(new Error('BrasilAPI recusou a consulta (400)'));
    await expect(processarEnriquecimento({ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
