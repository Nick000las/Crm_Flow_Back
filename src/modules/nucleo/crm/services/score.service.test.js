import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  contarLeadsDoTenant,
  gravarScoresEmLote,
  listarFaixasScore,
  listarRegrasScore,
  registrarProgressoRecalculo,
  salvarRegrasEFaixas,
} from '../adapters/crm-score.repository.js';
import { CAMADA, FAIXAS_SCORE_PADRAO, LIMITES_SCORE } from '../constants.js';
import {
  expressaoDoScore,
  faixaDoScore,
  garantirScoreNaoEditado,
  limitesDaFaixa,
  normalizarFaixas,
  recalcularTodos,
  salvarConfigScore,
} from './score.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('../adapters/crm-score.repository.js', () => ({
  listarRegrasScore: vi.fn(),
  listarFaixasScore: vi.fn(),
  salvarRegrasEFaixas: vi.fn(),
  gravarScores: vi.fn(),
  gravarScoresEmLote: vi.fn(),
  contarLeadsDoTenant: vi.fn(),
  buscarProgressoRecalculo: vi.fn(),
  registrarProgressoRecalculo: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID_ORIGEM = '00000000-0000-0000-0000-0000000000a1';
const ID_SALARIO = '00000000-0000-0000-0000-0000000000a2';
const ID_SCORE = '00000000-0000-0000-0000-0000000000a3';
const CAMPOS = [
  { id: ID_ORIGEM, chave: 'fonteLead', label: 'Origem', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { id: ID_SALARIO, chave: 'salario', label: 'Salário', tipo: 'numero', camada: CAMADA.CAMADA_3 },
  { id: ID_SCORE, chave: 'leadScore', label: 'Lead score', tipo: 'numero', camada: CAMADA.CAMADA_2 },
];
// O score liga o campo Lead score ao salvar; aqui ele já está visível.
vi.mock('./configuracoes-campos.service.js', () => ({
  listarConfiguracaoCampos: vi.fn(async () => [
    { id: ID_SCORE, chave: 'leadScore', visibilidade: { create_form: false, detail: true, table: true, filter: true } },
  ]),
  atualizarConfiguracaoCampo: vi.fn(),
}));
vi.mock('./field-schema.service.js', () => ({ obterSchemaCampos: vi.fn(async () => ({ campos: CAMPOS })) }));

const PONTOS_SITE = 20;
const PONTOS_SALARIO = 15;
const ACIMA_DO_LIMITE = LIMITES_SCORE.CONDICOES_POR_REGRA + 1;
const QUENTE = 75;
const MORNO = 30;
const FRIO_NEGATIVO = -10;
const LIMITE_FRIO = 29;
const SALARIO_MINIMO = 5000;
const PENALIDADE = -5;
const REGRAS_SOMADAS = 3;
const INICIO_MORNO = 30;
const FIM_MORNO = 69;
const INICIO_MUITO_QUENTE = 90;
const LIMITE = 50;
const DEZ = 10;
const VINTE = 20;
const TRINTA = 30;
const DUAS_FAIXAS = 2;
const SEGUNDO_LOTE = 2;
const DIGITOS_ID = 4;

const doSite = { campoId: ID_ORIGEM, operador: 'igual', valor: 'site' };
const salarioAlto = { campoId: ID_SALARIO, operador: 'entre', valor: { de: SALARIO_MINIMO } };

/** O texto SQL com os parâmetros no lugar dos `$n` — só pra conferir a forma. */
const sql = (expressao) => ({ texto: expressao.sql, valores: expressao.values });

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  listarRegrasScore.mockResolvedValue([]);
  listarFaixasScore.mockResolvedValue([]);
});

describe('expressaoDoScore', () => {
  it('soma um CASE por regra ativa; condições com E; sem condição = sempre', () => {
    const { texto, valores } = sql(
      expressaoDoScore(
        [
          { ativo: true, pontos: PONTOS_SITE, condicoes: [doSite] },
          { ativo: true, pontos: PONTOS_SALARIO, condicoes: [doSite, salarioAlto] },
          { ativo: true, pontos: PENALIDADE, condicoes: [] },
        ],
        CAMPOS,
      ),
    );
    // Uma parcela por regra (a condição em si também pode ter CASE).
    expect(texto.match(/ELSE 0 END/g)).toHaveLength(REGRAS_SOMADAS);
    expect(texto).toContain(' AND ');
    expect(texto).toContain('TRUE');
    expect(valores).toEqual(expect.arrayContaining([PONTOS_SITE, PONTOS_SALARIO, PENALIDADE]));
  });

  it('regra desligada, com campo sumido, sobre o próprio score ou com condição inválida é ignorada', () => {
    const { texto } = sql(
      expressaoDoScore(
        [
          { ativo: false, pontos: 1, condicoes: [] },
          { ativo: true, pontos: 1, condicoes: [{ campoId: '00000000-0000-0000-0000-00000000dead', operador: 'vazio' }] },
          { ativo: true, pontos: 1, condicoes: [{ campoId: ID_SCORE, operador: 'nao_vazio' }] },
          // "contem" não vale pra número (o tipo do campo mudou depois de salvar a regra).
          { ativo: true, pontos: 1, condicoes: [{ campoId: ID_SALARIO, operador: 'contem', valor: 'x' }] },
        ],
        CAMPOS,
      ),
    );
    expect(texto).toBe('0');
  });
});

describe('faixas', () => {
  it('faixaDoScore: limites inclusivos, negativo cai no Frio, nulo fica sem faixa', () => {
    const faixas = FAIXAS_SCORE_PADRAO;
    expect(faixaDoScore(faixas, QUENTE)?.chave).toBe('quente');
    expect(faixaDoScore(faixas, MORNO)?.chave).toBe('morno');
    expect(faixaDoScore(faixas, LIMITE_FRIO)?.chave).toBe('frio');
    expect(faixaDoScore(faixas, FRIO_NEGATIVO)?.chave).toBe('frio');
    expect(faixaDoScore(faixas, '75')?.chave).toBe('quente'); // Decimal do Prisma
    expect(faixaDoScore(faixas, null)).toBeNull();
  });

  it('nunca salvou: o filtro usa as padrão; faixa inexistente → 400 em filtros.faixaScore', async () => {
    expect(await limitesDaFaixa(TENANT, 'morno')).toEqual({ minimo: INICIO_MORNO, maximo: FIM_MORNO });
    await expect(limitesDaFaixa(TENANT, 'fervendo')).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { 'filtros.faixaScore': [expect.any(String)] },
    });
  });

  it('normalizarFaixas: chave do rótulo; sobreposição ou chave repetida → 400; buraco pode', () => {
    expect(normalizarFaixas([{ rotulo: 'Muito Quente', minimo: INICIO_MUITO_QUENTE, maximo: null, cor: '#000000' }])[0].chave).toBe('muito_quente');
    const invalido = { statusCode: HTTP_STATUS.BAD_REQUEST };
    expect(() =>
      normalizarFaixas([
        { rotulo: 'A', minimo: null, maximo: LIMITE, cor: '#000000' },
        { rotulo: 'B', minimo: LIMITE, maximo: null, cor: '#000000' },
      ]),
    ).toThrow(expect.objectContaining(invalido));
    expect(() =>
      normalizarFaixas([
        { rotulo: 'A', minimo: 0, maximo: DEZ, cor: '#000000' },
        { rotulo: 'a', minimo: VINTE, maximo: TRINTA, cor: '#000000' },
      ]),
    ).toThrow(expect.objectContaining(invalido));
    expect(
      normalizarFaixas([
        { rotulo: 'A', minimo: 0, maximo: DEZ, cor: '#000000' },
        { rotulo: 'B', minimo: VINTE, maximo: TRINTA, cor: '#000000' },
      ]),
    ).toHaveLength(DUAS_FAIXAS);
  });
});

describe('recalcularTodos', () => {
  it('em lotes pelo cursor do último id, gravando o progresso; flag desligada não faz nada', async () => {
    const lote = LIMITES_SCORE.LOTE_RECALCULO;
    const primeiro = Array.from({ length: lote }, (_, i) => `id-${String(i).padStart(DIGITOS_ID, '0')}`);
    contarLeadsDoTenant.mockResolvedValue(lote + 1);
    gravarScoresEmLote.mockResolvedValueOnce(primeiro).mockResolvedValueOnce(['id-9999']);

    expect(await recalcularTodos(TENANT)).toEqual({ total: lote + 1, processados: lote + 1 });
    expect(gravarScoresEmLote).toHaveBeenNthCalledWith(1, TENANT, expect.anything(), null, lote);
    expect(gravarScoresEmLote).toHaveBeenNthCalledWith(SEGUNDO_LOTE, TENANT, expect.anything(), primeiro.at(-1), lote);
    expect(registrarProgressoRecalculo).toHaveBeenCalledWith(TENANT, { total: lote + 1, processados: 0, inicio: true });
    expect(registrarProgressoRecalculo).toHaveBeenLastCalledWith(TENANT, { total: lote + 1, processados: lote + 1, concluido: true });

    vi.clearAllMocks();
    featureAtiva.mockResolvedValue(false);
    expect(await recalcularTodos(TENANT)).toEqual({ total: 0, processados: 0 });
    expect(gravarScoresEmLote).not.toHaveBeenCalled();
  });
});

describe('salvarConfigScore', () => {
  const faixas = [{ rotulo: 'Frio', minimo: null, maximo: LIMITE_FRIO, cor: '#3B82F6' }];

  it('grava e recalcula todos', async () => {
    contarLeadsDoTenant.mockResolvedValue(0);
    gravarScoresEmLote.mockResolvedValue([]);
    await salvarConfigScore(TENANT, { regras: [{ nome: ' Site ', ativo: true, pontos: PONTOS_SITE, condicoes: [doSite] }], faixas });
    expect(salvarRegrasEFaixas).toHaveBeenCalledWith(
      TENANT,
      [{ nome: 'Site', ativo: true, pontos: PONTOS_SITE, condicoes: [doSite] }],
      [expect.objectContaining({ chave: 'frio' })],
    );
    expect(gravarScoresEmLote).toHaveBeenCalled();
  });

  it('400: campo inexistente, sobre o próprio score, operador que não serve, condições demais', async () => {
    const tentar = (condicoes) => salvarConfigScore(TENANT, { regras: [{ nome: 'R', ativo: true, pontos: 1, condicoes }], faixas });
    const invalido = { statusCode: HTTP_STATUS.BAD_REQUEST };
    await expect(tentar([{ campoId: TENANT, operador: 'vazio' }])).rejects.toMatchObject(invalido);
    await expect(tentar([{ campoId: ID_SCORE, operador: 'nao_vazio' }])).rejects.toMatchObject(invalido);
    await expect(tentar([{ campoId: ID_SALARIO, operador: 'contem', valor: 'x' }])).rejects.toMatchObject(invalido);
    await expect(tentar(Array.from({ length: ACIMA_DO_LIMITE }, () => doSite))).rejects.toMatchObject(invalido);
    expect(salvarRegrasEFaixas).not.toHaveBeenCalled();
  });
});

describe('garantirScoreNaoEditado', () => {
  it('com a flag, leadScore no payload → 400; sem a flag, é manual', async () => {
    await expect(garantirScoreNaoEditado(TENANT, { leadScore: QUENTE })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { leadScore: [expect.any(String)] },
    });
    await expect(garantirScoreNaoEditado(TENANT, { nome: 'x' })).resolves.toBeUndefined();
    featureAtiva.mockResolvedValue(false);
    await expect(garantirScoreNaoEditado(TENANT, { leadScore: QUENTE })).resolves.toBeUndefined();
  });
});
