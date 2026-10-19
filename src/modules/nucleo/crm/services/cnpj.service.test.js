import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { provedorBrasilApi } from '../adapters/cnpj-brasilapi.provider.js';
import { enfileirarEnriquecimentos } from '../adapters/cnpj-queue.repository.js';
import { buscarCacheCnpj, buscarConfigCnpj, gravarCacheCnpj, salvarConfigCnpj as gravarConfig } from '../adapters/crm-cnpj.repository.js';
import { CAMADA } from '../constants.js';
import {
  agendarEnriquecimento,
  consultarCnpj,
  consultarParaLupa,
  obterConfigCnpj,
  salvarConfigCnpj,
  sugestaoParaLead,
} from './cnpj.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('../adapters/cnpj-brasilapi.provider.js', () => ({ provedorBrasilApi: { nome: 'brasilapi', consultar: vi.fn() } }));
vi.mock('../adapters/cnpj-queue.repository.js', () => ({ enfileirarEnriquecimentos: vi.fn(), encerrarFilaCnpj: vi.fn() }));
vi.mock('../adapters/crm-cnpj.repository.js', () => ({
  buscarCacheCnpj: vi.fn(),
  gravarCacheCnpj: vi.fn(),
  buscarConfigCnpj: vi.fn(),
  salvarConfigCnpj: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const CNPJ = '11222333000181';
const ID_EMPRESA = '00000000-0000-0000-0000-00000000e001';
const ID_CIDADE = '00000000-0000-0000-0000-00000000e002';
const ID_CEP = '00000000-0000-0000-0000-00000000e003';
const ID_ENTREGA = '00000000-0000-0000-0000-00000000e004';
const ID_FONE = '00000000-0000-0000-0000-00000000e005';

const CAMPOS = [
  { id: ID_EMPRESA, chave: 'empresa', label: 'Empresa', tipo: 'texto', camada: CAMADA.CAMADA_2 },
  { id: ID_CIDADE, chave: 'cidade', label: 'Cidade', tipo: 'texto', camada: CAMADA.CAMADA_2 },
  { id: ID_CEP, chave: 'cep', label: 'CEP', tipo: 'cep', camada: CAMADA.CAMADA_2 },
  { id: ID_ENTREGA, chave: 'entrega', label: 'Entrega', tipo: 'endereco', camada: CAMADA.CAMADA_3 },
  { id: ID_FONE, chave: 'fone', label: 'Fone', tipo: 'telefone', camada: CAMADA.CAMADA_3 },
];

const DADOS = {
  razaoSocial: 'ACME LTDA',
  logradouro: 'RUA X',
  numero: '10',
  bairro: 'CENTRO',
  municipio: 'RECIFE',
  uf: 'PE',
  cep: '50000000',
  telefone: '8133334444',
};

vi.mock('./field-schema.service.js', () => ({ obterSchemaCampos: vi.fn(async () => ({ campos: CAMPOS, definicoes: [] })) }));

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  buscarConfigCnpj.mockResolvedValue(undefined);
  buscarCacheCnpj.mockResolvedValue(undefined);
  provedorBrasilApi.consultar.mockResolvedValue({ status: 'ok', dados: DADOS });
});

describe('consultarCnpj (cache de 30 dias)', () => {
  it('cache válido evita a chamada ao provedor', async () => {
    buscarCacheCnpj.mockResolvedValue({ cnpj: CNPJ, status: 'ok', dados: DADOS, provedor: 'brasilapi' });
    const resultado = await consultarCnpj(TENANT, '11.222.333/0001-81');
    expect(resultado).toMatchObject({ cnpj: CNPJ, emCache: true, dados: DADOS });
    expect(provedorBrasilApi.consultar).not.toHaveBeenCalled();
  });

  it('sem cache: consulta, grava (inclusive "não encontrado") e só olha cache dos últimos 30 dias', async () => {
    const agora = new Date('2026-10-18T12:00:00Z');
    provedorBrasilApi.consultar.mockResolvedValue({ status: 'nao_encontrado', dados: {} });
    await consultarCnpj(TENANT, CNPJ, agora);
    expect(buscarCacheCnpj).toHaveBeenCalledWith(TENANT, CNPJ, new Date('2026-09-18T12:00:00Z'));
    expect(gravarCacheCnpj).toHaveBeenCalledWith(TENANT, expect.objectContaining({ cnpj: CNPJ, status: 'nao_encontrado' }));
  });

  it('"não suportado" (ex. alfanumérico no provedor) não vai pro cache', async () => {
    provedorBrasilApi.consultar.mockResolvedValue({ status: 'nao_suportado', dados: {} });
    await consultarCnpj(TENANT, '12ABC34501DE35');
    expect(gravarCacheCnpj).not.toHaveBeenCalled();
  });

  it('DV errado → 400, sem consultar', async () => {
    await expect(consultarCnpj(TENANT, '11222333000182')).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    expect(provedorBrasilApi.consultar).not.toHaveBeenCalled();
  });
});

describe('lupa', () => {
  it('devolve dados e sugestão pelo mapeamento padrão (campos do sistema)', async () => {
    const resposta = await consultarParaLupa(TENANT, CNPJ);
    expect(resposta.status).toBe('ok');
    expect(resposta.sugestao).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chave: 'empresa', valor: 'ACME LTDA' }),
        expect.objectContaining({ chave: 'cidade', valor: 'RECIFE' }),
        expect.objectContaining({ chave: 'cep', valor: '50000000' }),
      ]),
    );
  });

  it('provedor fora do ar → 503 (o formulário segue funcionando)', async () => {
    provedorBrasilApi.consultar.mockRejectedValue(Object.assign(new Error('timeout'), { transitorio: true }));
    await expect(consultarParaLupa(TENANT, CNPJ)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.EXTERNAL_SERVICE_UNAVAILABLE,
    });
  });
});

describe('sugestaoParaLead', () => {
  it('converte pro tipo do destino: endereço como objeto, telefone em dígitos', () => {
    const sugestao = sugestaoParaLead(DADOS, { endereco: ID_ENTREGA, telefone: ID_FONE }, CAMPOS);
    expect(sugestao).toEqual([
      expect.objectContaining({
        chave: 'entrega',
        camada: CAMADA.CAMADA_3,
        valor: { cep: '50000000', logradouro: 'RUA X', numero: '10', bairro: 'CENTRO', cidade: 'RECIFE', uf: 'PE' },
      }),
      expect.objectContaining({ chave: 'fone', valor: '8133334444' }),
    ]);
  });

  it('endereço em campo de texto vira uma linha; valor inválido pro tipo fica de fora', () => {
    const sugestao = sugestaoParaLead({ ...DADOS, telefone: '123' }, { endereco: ID_EMPRESA, telefone: ID_FONE }, CAMPOS);
    expect(sugestao).toEqual([expect.objectContaining({ chave: 'empresa', valor: 'RUA X, 10 - CENTRO, RECIFE/PE' })]);
  });
});

describe('configuração', () => {
  it('sem linha: padrão (manual, sem sobrescrever), mapeando pros campos do sistema ativos', async () => {
    const config = await obterConfigCnpj(TENANT);
    expect(config).toMatchObject({ ativo: true, modo: 'manual', sobrescrever: false, configurado: false });
    // `uf` e `endereco` nativos não estão ativos neste tenant: ficam de fora.
    expect(config.mapeamento).toEqual({ razaoSocial: ID_EMPRESA, municipio: ID_CIDADE, cep: ID_CEP });
  });

  it('gravada: mapeamento pra campo que sumiu cai fora', async () => {
    buscarConfigCnpj.mockResolvedValue({
      ativo: true,
      modo: 'automatico',
      sobrescrever: true,
      mapeamento: { razaoSocial: ID_EMPRESA, nomeFantasia: '00000000-0000-0000-0000-00000000dead' },
    });
    expect((await obterConfigCnpj(TENANT)).mapeamento).toEqual({ razaoSocial: ID_EMPRESA });
  });

  it('salvar: destino de tipo incompatível ou repetido → 400', async () => {
    const base = { ativo: true, modo: 'automatico', sobrescrever: false };
    await expect(salvarConfigCnpj(TENANT, { ...base, mapeamento: { razaoSocial: ID_CEP } })).rejects.toMatchObject({
      fields: { 'mapeamento.razaoSocial': [expect.stringContaining('não cabe')] },
    });
    await expect(
      salvarConfigCnpj(TENANT, { ...base, mapeamento: { razaoSocial: ID_EMPRESA, nomeFantasia: ID_EMPRESA } }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    expect(gravarConfig).not.toHaveBeenCalled();
  });
});

describe('agendarEnriquecimento (automático)', () => {
  const LEAD = '00000000-0000-0000-0000-0000000000l1';
  const automatico = { ativo: true, modo: 'automatico', sobrescrever: false, mapeamento: {} };

  it('modo automático: enfileira com o CNPJ normalizado', async () => {
    buscarConfigCnpj.mockResolvedValue(automatico);
    expect(await agendarEnriquecimento(TENANT, [{ leadId: LEAD, cnpj: '11.222.333/0001-81' }])).toBe(1);
    expect(enfileirarEnriquecimentos).toHaveBeenCalledWith([{ tenantId: TENANT, leadId: LEAD, cnpj: CNPJ }]);
  });

  it('modo manual, flag desligada ou CNPJ inválido: nada na fila', async () => {
    expect(await agendarEnriquecimento(TENANT, [{ leadId: LEAD, cnpj: CNPJ }])).toBe(0); // padrão = manual

    buscarConfigCnpj.mockResolvedValue(automatico);
    featureAtiva.mockResolvedValue(false);
    expect(await agendarEnriquecimento(TENANT, [{ leadId: LEAD, cnpj: CNPJ }])).toBe(0);

    featureAtiva.mockResolvedValue(true);
    expect(await agendarEnriquecimento(TENANT, [{ leadId: LEAD, cnpj: '123' }])).toBe(0);
    expect(enfileirarEnriquecimentos).not.toHaveBeenCalled();
  });

  it('fila fora do ar não sobe erro (o lead já foi salvo)', async () => {
    buscarConfigCnpj.mockResolvedValue(automatico);
    enfileirarEnriquecimentos.mockRejectedValue(new Error('REDIS_URL não configurado'));
    await expect(agendarEnriquecimento(TENANT, [{ leadId: LEAD, cnpj: CNPJ }])).resolves.toBe(0);
  });
});

describe('lupa com o enriquecimento desligado nas configurações', () => {
  it('403, sem gastar consulta no provedor', async () => {
    buscarConfigCnpj.mockResolvedValue({ ativo: false, modo: 'manual', sobrescrever: false, mapeamento: {} });
    await expect(consultarParaLupa(TENANT, CNPJ)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'A consulta de CNPJ está desligada nas configurações',
    });
    expect(provedorBrasilApi.consultar).not.toHaveBeenCalled();
  });
});
