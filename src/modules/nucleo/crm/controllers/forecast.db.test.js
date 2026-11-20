import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { TenantManagement } from '#core/tenant/management.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CATEGORIAS_STATUS, CRM_FEATURES, MODULO_CRM, TIPOS_PIPELINE } from '../constants.js';
import { ANONIMIZACAO } from '../constants/lgpd.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FC2 (docs/crm/plano-execucao-formularios-forecast.md): consulta e API do
 * forecast, só pela HTTP. GRAVA no banco de `DATABASE_URL` (tenant SMOKE,
 * apagado no fim): só roda com `CRM_DB_TESTS=1`, num banco de dev.
 *
 * Cenários com data exata: a oportunidade nasce pela API e `won_at`,
 * `expected_close_date` e o status são ajustados direto no banco. Como isso não
 * passa pelo outbox, `invalidarCache` mexe no `updated_at` das opções de status
 * (parte da marca do cache do forecast) depois de cada ajuste cru.
 *
 * Caso 12 (tenant vazio): é o primeiro teste do arquivo, antes de qualquer
 * oportunidade existir no tenant, em vez de um segundo tenant.
 *
 * Cada teste começa sem oportunidades (`beforeEach`) e usa datas relativas ao
 * "hoje" no fuso do tenant; só o caso do fuso usa datas fixas.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const FUSO = 'America/Sao_Paulo';
const MESES_NO_ANO = 12;
const DUAS = 2;
const MESES_A_FRENTE = 2;
const DIGITOS_MES = 2;
const TAMANHO_MES = 7;
const TAMANHO_DATA = 10;
const DIA_PADRAO = '15';
const PERCENTUAL = 100;
const CENTAVOS = 100;
const MESES_PADRAO_DE_CADA_LADO = 3;
const MESES_DO_PERIODO_PADRAO = 7;
const QTD_STATUS_ABERTOS = 4;
const QTD_NA_SOMA = 20;
const QTD_COM_OVERRIDE = 10;
const BASE_CENTAVOS = 100_037;
const PASSO_CENTAVOS = 3737;
const BASE_OVERRIDE = 15;
const PASSO_OVERRIDE = 7;
const VALOR_PADRAO = 1000;
const VALOR_ATRASADA = 800;
const VALOR_SEM_PREVISAO = 500;
const VALOR_ALEM = 700;
const VALOR_GRANDE = 2000;
const VALOR_PEQUENO = 100;
const PADRAO_EDITADO = 33;
const DIAS_ATRAS_LONGE = 400;
const MESES_ALEM = 6;
const DESLOCAMENTO_MES_NOVO = 3;
const QTD_DO_DONO = 3;
const QTD_DO_OPERADOR = 2;
const POR_PAGINA = 2;
const FUSO_FRONTEIRA_ANTES = '2026-11-01 02:30:00';
const FUSO_FRONTEIRA_DEPOIS = '2026-11-01 03:30:00';
const MESES_ATE_ANTES_DO_PERIODO = 4;
const CHAVES_MONETARIAS = ['soma', 'ponderado', 'previsto'];
const CONTEXTOS_DO_CAMPO = ['create_form', 'detail', 'table', 'filter'];
const visibilidadeEm = (visivel) =>
  Object.fromEntries(CONTEXTOS_DO_CAMPO.map((contexto) => [contexto, visivel]));

const centavos = (reais) => Math.round(reais * CENTAVOS);
/** Ponderado de um item em centavos (a soma do banco arredonda uma vez, no fim). */
const ponderadoEmCentavos = (itens) =>
  Math.round(itens.reduce((total, { c, p }) => total + c * p, 0) / PERCENTUAL);

const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
const somarDias = (iso, dias) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, TAMANHO_DATA);
};
const somarMeses = (mes, n) => {
  const [ano, numero] = mes.split('-').map(Number);
  const total = ano * MESES_NO_ANO + (numero - 1) + n;
  const novoMes = String((total % MESES_NO_ANO) + 1).padStart(DIGITOS_MES, '0');
  return `${Math.floor(total / MESES_NO_ANO)}-${novoMes}`;
};
const diaDoMes = (mes) => `${mes}-${DIA_PADRAO}`;

/** Todo (caminho, valor) de chave monetária da resposta; `ponderado` objeto desce. */
function varrerMonetarios(no, caminho = '$') {
  if (Array.isArray(no)) return no.flatMap((x, i) => varrerMonetarios(x, `${caminho}[${i}]`));
  if (!no || typeof no !== 'object') return [];
  return Object.entries(no).flatMap(([chave, valor]) => {
    const aqui = `${caminho}.${chave}`;
    const folha = valor === null || typeof valor !== 'object';
    if (CHAVES_MONETARIAS.includes(chave) && folha) return [{ caminho: aqui, valor }];
    return varrerMonetarios(valor, aqui);
  });
}

rodar('FC2: forecast pela API (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  const hoje = hojeLocal();
  const mesAtual = hoje.slice(0, TAMANHO_MES);
  const mesFuturo = somarMeses(mesAtual, MESES_A_FRENTE);
  const COM_FORECAST = [CRM_FEATURES.PERMISSOES, CRM_FEATURES.FORECAST];
  let app;
  let vendas;
  let ganhoKey;

  async function chamar(method, url, payload, { papel = 'DONO', userId = donoId } = {}) {
    const token = app.jwt.access.sign({ tenantId, userId, role: papel });
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }
  const operador = { papel: 'OPERADOR', userId: operadorId };
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;
    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
    return resposta.dados;
  };
  const pipelines = () => ok(chamar('GET', '/crm/configuracoes/pipelines'));
  const statusDeVendas = async () => (await pipelines()).find((p) => p.id === vendas.id).status;
  const abertosDeVendas = async () =>
    (await statusDeVendas())
      .filter((s) => s.category === CATEGORIAS_STATUS.ABERTO && s.ativo !== false)
      .slice(0, QTD_STATUS_ABERTOS);
  const padraoDe = async (chave) =>
    (await statusDeVendas()).find((s) => s.key === chave).probabilidadePadrao;

  const forecast = (query = {}, quem) =>
    chamar('GET', `/crm/forecast?${new URLSearchParams(query)}`, undefined, quem);
  const lista = (query, quem) =>
    chamar('GET', `/crm/forecast/oportunidades?${new URLSearchParams(query)}`, undefined, quem);
  const dadosDe = (promessa) => ok(promessa);
  const mesDe = (dados, mes) => dados.meses.find((m) => m.mes === mes);
  const emCentavos = (valor) => Math.round(Number(valor) * CENTAVOS);

  /** Muda a marca do cache depois de um ajuste cru (que não passa pelo outbox). */
  async function invalidarCache() {
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_option SET updated_at = clock_timestamp()
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'status'
    `;
  }

  /**
   * Pessoa nova com uma oportunidade pela API. Criar a pessoa já cria uma
   * oportunidade em Novo, sem valor nem data (F-1); ela é apagada para o
   * cenário ter só a oportunidade pedida.
   */
  async function criar({
    valor = VALOR_PADRAO,
    data,
    status,
    override,
    pipelineId,
    responsavelId,
  } = {}) {
    const lead = await ok(
      chamar('POST', '/crm/leads', { nome: 'Pessoa', email: `${randomUUID()}@smoke.test` }),
      HTTP_STATUS.CREATED,
    );
    await prisma.$executeRaw`
      DELETE FROM modulo_crm.crm_deal
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${lead.id}::uuid
    `;
    const criada = await ok(
      chamar('POST', `/crm/leads/${lead.id}/oportunidades`, {
        ...(pipelineId && { pipelineId }),
        ...(status && { status }),
        ...(valor !== null && { valor }),
        ...(data && { dataPrevistaFechamento: data }),
        ...(override !== undefined && { probabilidadeFechamento: override }),
        ...(responsavelId && { responsavelId }),
      }),
      HTTP_STATUS.CREATED,
    );
    return criada.id;
  }

  async function definirPrevista(id, iso) {
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal SET expected_close_date = ${iso}::date
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    await invalidarCache();
  }

  /** Ganha em `ganhaEmUtc` (timestamp sem fuso, em UTC), respeitando chk_crm_deal_datas. */
  async function marcarGanha(id, ganhaEmUtc) {
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal
      SET status = ${ganhoKey}, status_category = 'ganho', won_at = ${ganhaEmUtc}::timestamp,
          lost_at = NULL, probability_override = NULL
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    await invalidarCache();
  }

  async function permissaoDoOperador(chave, acesso) {
    const campo = (await listarConfiguracaoCampos(tenantId)).find((c) => c.chave === chave);
    await ok(chamar('PUT', '/crm/configuracoes/permissoes', { OPERADOR: { [campo.id]: acesso } }));
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE forecast FC2',
        subdomain: `smoke-fc2-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });
    await prisma.usuario.createMany({
      data: [
        { id: donoId, role: 'DONO' },
        { id: operadorId, role: 'OPERADOR' },
      ].map(({ id, role }) => ({
        id,
        tenantId,
        nome: role === 'DONO' ? 'Dona Maria' : 'Operador João',
        email: `${id}@smoke.test`,
        senhaHash: 'test',
        role,
      })),
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.createMany({
      data: [CRM_FEATURES.PERMISSOES].map((featureKey) => ({
        tenantId,
        moduleKey: MODULO_CRM,
        featureKey,
      })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    app = await buildApp({
      config: {
        APP_NAME: 'crm-forecast-fc2',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    // Liga Data prevista e Probabilidade como em produção.
    await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
    vendas = (await pipelines()).find((p) => p.tipo === TIPOS_PIPELINE.VENDAS && p.padrao);
    ganhoKey = (await statusDeVendas()).find((s) => s.category === CATEGORIAS_STATUS.GANHO).key;
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid`;
    await invalidarCache();
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('tenant sem oportunidade (caso 12)', () => {
    it('vazio: true, forma completa com zeros e período padrão de 3 meses para cada lado', async () => {
      const dados = await dadosDe(forecast());
      expect(dados.vazio).toBe(true);
      expect(dados.fuso).toBe(FUSO);
      expect(dados.hoje).toBe(hoje);
      expect(dados.periodo).toEqual({
        de: somarMeses(mesAtual, -MESES_PADRAO_DE_CADA_LADO),
        ate: somarMeses(mesAtual, MESES_PADRAO_DE_CADA_LADO),
      });
      expect(dados.meses).toHaveLength(MESES_DO_PERIODO_PADRAO);
      expect(dados.veValor).toBe(true);
      expect(dados.camposDesligados).toEqual([]);
      expect(dados.grupos).toEqual([]);
      for (const mes of dados.meses) {
        expect(mes.realizado).toEqual({ quantidade: 0, soma: 0 });
        expect(mes.ponderado.quantidade).toBe(0);
        expect(Number(mes.previsto)).toBe(0);
      }
      expect(dados.blocos.atrasadas.quantidade).toBe(0);
      expect(dados.blocos.semValor).toEqual({ quantidade: 0 });
    });

    it('com a primeira oportunidade, vazio vira false', async () => {
      await criar({ data: diaDoMes(mesFuturo) });
      expect((await dadosDe(forecast())).vazio).toBe(false);
    });
  });

  it('caso 1: ponderado, melhor caso e quantidade de 20 abertas batem com a soma em centavos', async () => {
    const abertos = await abertosDeVendas();
    const itens = [];
    for (let i = 0; i < QTD_NA_SOMA; i += 1) {
      const status = abertos[i % abertos.length];
      const override = i < QTD_COM_OVERRIDE ? BASE_OVERRIDE + i * PASSO_OVERRIDE : undefined;
      const c = BASE_CENTAVOS + i * PASSO_CENTAVOS;
      await criar({
        valor: c / CENTAVOS,
        data: diaDoMes(mesFuturo),
        status: status.key,
        override,
      });
      itens.push({ c, p: override ?? status.probabilidadePadrao });
    }

    const dados = await dadosDe(forecast({ de: mesAtual, ate: mesFuturo }));
    const mes = mesDe(dados, mesFuturo);
    const cheio = itens.reduce((total, { c }) => total + c, 0);
    const ponderado = ponderadoEmCentavos(itens);
    expect(mes.ponderado.quantidade).toBe(QTD_NA_SOMA);
    expect(emCentavos(mes.ponderado.soma)).toBe(ponderado);
    expect(emCentavos(mes.melhorCaso.soma)).toBe(cheio);
    expect(emCentavos(mes.previsto)).toBe(ponderado);
    expect(mes.realizado.quantidade).toBe(0);
    expect(dados.vazio).toBe(false);
    expect(dados.blocos.semValor.quantidade).toBe(0);
    expect(dados.blocos.atrasadas.quantidade).toBe(0);
    expect(mesDe(dados, mesAtual).ponderado.quantidade).toBe(0);
  });

  it('caso 2: fuso, ganha em 01/11 02:30 UTC cai em outubro (São Paulo), não em novembro', async () => {
    const antes = await criar({ valor: VALOR_PADRAO });
    const depois = await criar({ valor: VALOR_ATRASADA });
    await marcarGanha(antes, FUSO_FRONTEIRA_ANTES);
    await marcarGanha(depois, FUSO_FRONTEIRA_DEPOIS);

    const dados = await dadosDe(forecast({ de: '2026-10', ate: '2026-11' }));
    expect(mesDe(dados, '2026-10').realizado).toEqual({ quantidade: 1, soma: VALOR_PADRAO });
    expect(mesDe(dados, '2026-11').realizado).toEqual({ quantidade: 1, soma: VALOR_ATRASADA });
  });

  it('caso 3: OPERADOR sem Valor não recebe valor monetário em lugar nenhum; as contagens ficam', async () => {
    await criar({ valor: VALOR_ATRASADA, data: diaDoMes(mesFuturo) });
    await criar({
      valor: VALOR_PADRAO,
      data: diaDoMes(mesFuturo),
      responsavelId: operadorId,
    });
    const atrasada = await criar({ valor: VALOR_PEQUENO, responsavelId: donoId });
    await definirPrevista(atrasada, somarDias(hoje, -1));
    const ganha = await criar({ valor: VALOR_GRANDE });
    await marcarGanha(ganha, `${mesAtual}-01 12:00:00`);

    const query = { de: mesAtual, ate: mesFuturo, agrupar: 'responsavel' };
    // O dono primeiro: o cache guarda o agregado cheio e o operador recebe mascarado.
    const doDono = await dadosDe(forecast(query));
    expect(doDono.veValor).toBe(true);
    expect(varrerMonetarios(doDono).some(({ valor }) => valor !== null)).toBe(true);

    await permissaoDoOperador('valor', 'hidden');
    try {
      const doOperador = await dadosDe(forecast(query, operador));
      expect(doOperador.veValor).toBe(false);
      const monetarios = varrerMonetarios(doOperador);
      expect(monetarios.length).toBeGreaterThan(0);
      for (const { caminho, valor } of monetarios) expect(valor, caminho).toBeNull();
      expect(doOperador.grupos.length).toBeGreaterThan(0);
      expect(mesDe(doOperador, mesFuturo).melhorCaso.soma).toBeNull();
      expect(doOperador.blocos.atrasadas.soma).toBeNull();

      expect(mesDe(doOperador, mesFuturo).ponderado.quantidade).toBe(
        mesDe(doDono, mesFuturo).ponderado.quantidade,
      );
      expect(mesDe(doOperador, mesAtual).realizado.quantidade).toBe(1);
      expect(doOperador.blocos.atrasadas.quantidade).toBe(1);

      const itens = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto' }, operador));
      expect(itens.total).toBe(DUAS);
      for (const item of itens.itens) {
        expect(item).not.toHaveProperty('valor');
        expect(item).not.toHaveProperty('ponderado');
      }
    } finally {
      await permissaoDoOperador('valor', 'edit');
    }
  });

  it('caso 4: pipeline oculto para o OPERADOR fica fora dos totais dele, e o pipelineId dele é 404', async () => {
    await ok(
      chamar('POST', '/crm/configuracoes/pipelines', {
        nome: 'Vendas oculto',
        tipo: TIPOS_PIPELINE.VENDAS,
      }),
      HTTP_STATUS.CREATED,
    );
    const oculto = (await pipelines()).find((p) => p.nome === 'Vendas oculto');
    await ok(
      chamar('PUT', `/crm/configuracoes/pipelines/${oculto.id}`, { visivelOperador: false }),
    );

    await criar({ data: diaDoMes(mesFuturo) });
    await criar({ data: diaDoMes(mesFuturo), pipelineId: oculto.id });

    const query = { de: mesAtual, ate: mesFuturo };
    const doDono = await dadosDe(forecast(query));
    expect(mesDe(doDono, mesFuturo).ponderado.quantidade).toBe(DUAS);
    const doOperador = await dadosDe(forecast(query, operador));
    expect(mesDe(doOperador, mesFuturo).ponderado.quantidade).toBe(1);

    const soOculto = await dadosDe(forecast({ ...query, pipelineId: oculto.id }));
    expect(mesDe(soOculto, mesFuturo).ponderado.quantidade).toBe(1);
    const negado = await forecast({ ...query, pipelineId: oculto.id }, operador);
    expect(negado.status).toBe(HTTP_STATUS.NOT_FOUND);

    const itens = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto' }, operador));
    expect(itens.total).toBe(1);
  });

  it('caso 5: reabrir, excluir e restaurar mudam o forecast no pedido seguinte (sem cache velho)', async () => {
    const novo = (await abertosDeVendas())[0];
    const id = await criar({ valor: VALOR_PADRAO, data: diaDoMes(mesFuturo), status: novo.key });
    await ok(chamar('PATCH', `/crm/oportunidades/${id}/status`, { status: ganhoKey }));
    const query = { de: mesAtual, ate: mesFuturo };
    const ponderadoCents = ponderadoEmCentavos([
      { c: centavos(VALOR_PADRAO), p: novo.probabilidadePadrao },
    ]);

    let dados = await dadosDe(forecast(query));
    expect(mesDe(dados, mesAtual).realizado).toEqual({ quantidade: 1, soma: VALOR_PADRAO });
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(0);

    await ok(chamar('PATCH', `/crm/oportunidades/${id}/status`, { status: novo.key }));
    dados = await dadosDe(forecast(query));
    expect(mesDe(dados, mesAtual).realizado.quantidade).toBe(0);
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(1);
    expect(emCentavos(mesDe(dados, mesFuturo).ponderado.soma)).toBe(ponderadoCents);

    await ok(chamar('POST', `/crm/oportunidades/${id}/excluir`));
    dados = await dadosDe(forecast(query));
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(0);
    expect(dados.vazio).toBe(true);

    await ok(chamar('POST', `/crm/oportunidades/${id}/restaurar`));
    dados = await dadosDe(forecast(query));
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(1);
    expect(emCentavos(mesDe(dados, mesFuturo).ponderado.soma)).toBe(ponderadoCents);
  });

  it('caso 6: mudar a probabilidade padrão do status muda o ponderado no pedido seguinte', async () => {
    const novo = (await abertosDeVendas())[0];
    await criar({ valor: VALOR_GRANDE, data: diaDoMes(mesFuturo), status: novo.key });
    const query = { de: mesAtual, ate: mesFuturo };

    const antes = await dadosDe(forecast(query));
    expect(emCentavos(mesDe(antes, mesFuturo).ponderado.soma)).toBe(
      ponderadoEmCentavos([{ c: centavos(VALOR_GRANDE), p: novo.probabilidadePadrao }]),
    );

    const url = `/crm/configuracoes/pipelines/${vendas.id}/status/${novo.id}`;
    await ok(chamar('PUT', url, { probabilidadePadrao: PADRAO_EDITADO }));
    try {
      const depois = await dadosDe(forecast(query));
      expect(emCentavos(mesDe(depois, mesFuturo).ponderado.soma)).toBe(
        ponderadoEmCentavos([{ c: centavos(VALOR_GRANDE), p: PADRAO_EDITADO }]),
      );
    } finally {
      await ok(chamar('PUT', url, { probabilidadePadrao: novo.probabilidadePadrao }));
    }
  });

  it('caso 7: atrasada, sem previsão, além do horizonte e sem valor contam só no bloco', async () => {
    const pNovo = await padraoDe((await abertosDeVendas())[0].key);
    const mesProximo = somarMeses(mesAtual, 1);
    const atrasadaOntem = await criar({ valor: VALOR_ATRASADA });
    await definirPrevista(atrasadaOntem, somarDias(hoje, -1));
    const atrasadaLonge = await criar({ valor: VALOR_PADRAO });
    await definirPrevista(atrasadaLonge, somarDias(hoje, -DIAS_ATRAS_LONGE));
    await criar({ valor: VALOR_SEM_PREVISAO });
    await criar({ valor: VALOR_ALEM, data: diaDoMes(somarMeses(mesAtual, MESES_ALEM)) });
    await criar({ valor: null, data: diaDoMes(mesProximo) });

    const dados = await dadosDe(forecast({ de: mesAtual, ate: mesProximo }));
    const { blocos } = dados;
    const atrasadas = [
      { c: centavos(VALOR_ATRASADA), p: pNovo },
      { c: centavos(VALOR_PADRAO), p: pNovo },
    ];
    expect(blocos.atrasadas.quantidade).toBe(atrasadas.length);
    expect(emCentavos(blocos.atrasadas.soma)).toBe(centavos(VALOR_ATRASADA + VALOR_PADRAO));
    expect(emCentavos(blocos.atrasadas.ponderado)).toBe(ponderadoEmCentavos(atrasadas));
    expect(blocos.semPrevisao.quantidade).toBe(1);
    expect(emCentavos(blocos.semPrevisao.soma)).toBe(centavos(VALOR_SEM_PREVISAO));
    expect(emCentavos(blocos.semPrevisao.ponderado)).toBe(
      ponderadoEmCentavos([{ c: centavos(VALOR_SEM_PREVISAO), p: pNovo }]),
    );
    expect(blocos.alemDoHorizonte.quantidade).toBe(1);
    expect(emCentavos(blocos.alemDoHorizonte.soma)).toBe(centavos(VALOR_ALEM));
    expect(blocos.semValor).toEqual({ quantidade: 1 });

    // Nenhuma das três primeiras entra em mês algum; a sem valor tem data e entra
    // no mês dela, com quantidade e soma zero (a tabela do forecast conta a quantidade).
    const noMes = dados.meses.reduce((total, mes) => total + mes.ponderado.quantidade, 0);
    expect(noMes).toBe(1);
    const mes = mesDe(dados, mesProximo);
    expect(mes.ponderado.quantidade).toBe(1);
    expect(Number(mes.ponderado.soma)).toBe(0);
    expect(Number(mes.melhorCaso.soma)).toBe(0);
  });

  it('caso 8: agrupar por responsável soma os totais do topo; por status exige pipelineId', async () => {
    const aberto = (await abertosDeVendas())[0];
    const data = diaDoMes(mesFuturo);
    for (let i = 0; i < QTD_DO_DONO; i += 1) {
      await criar({ valor: VALOR_GRANDE + i, data, responsavelId: donoId });
    }
    for (let i = 0; i < QTD_DO_OPERADOR; i += 1) {
      await criar({ valor: VALOR_PEQUENO + i, data, responsavelId: operadorId });
    }
    // Oportunidade nova herda o responsável da pessoa: o "sem responsável" é feito no banco.
    const semResponsavel = await criar({ valor: VALOR_PEQUENO, data });
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal SET owner_id = NULL
      WHERE id = ${semResponsavel}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    await invalidarCache();
    const atrasada = await criar({ valor: VALOR_ATRASADA, responsavelId: operadorId });
    await definirPrevista(atrasada, somarDias(hoje, -1));

    const query = { de: mesAtual, ate: mesFuturo };
    const dados = await dadosDe(forecast({ ...query, agrupar: 'responsavel' }));
    expect(dados.grupos).toHaveLength(QTD_DO_DONO);
    expect(dados.grupos.map((g) => g.chave)).toEqual([donoId, operadorId, null]);
    expect(dados.grupos[2].rotulo).toBe('Sem responsável');
    expect(dados.grupos[0].rotulo).toBe('Dona Maria');

    const somar = (pegar) => dados.grupos.reduce((total, g) => total + pegar(g), 0);
    for (const { mes } of dados.meses) {
      const topo = mesDe(dados, mes);
      expect(somar((g) => mesDe(g, mes).ponderado.quantidade)).toBe(topo.ponderado.quantidade);
      expect(somar((g) => emCentavos(mesDe(g, mes).ponderado.soma))).toBe(
        emCentavos(topo.ponderado.soma),
      );
      expect(somar((g) => emCentavos(mesDe(g, mes).melhorCaso.soma))).toBe(
        emCentavos(topo.melhorCaso.soma),
      );
    }
    expect(somar((g) => g.blocos.atrasadas.quantidade)).toBe(dados.blocos.atrasadas.quantidade);
    expect(somar((g) => emCentavos(g.blocos.atrasadas.soma))).toBe(
      emCentavos(dados.blocos.atrasadas.soma),
    );

    const semPipeline = await forecast({ ...query, agrupar: 'status' });
    expect(semPipeline.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const porStatus = await dadosDe(
      forecast({ ...query, agrupar: 'status', pipelineId: vendas.id }),
    );
    const grupoAberto = porStatus.grupos.find((g) => g.chave === aberto.key);
    expect(grupoAberto).toBeTruthy();
    expect(grupoAberto.rotulo).toBe(aberto.label);
    expect(
      porStatus.grupos.reduce((total, g) => total + mesDe(g, mesFuturo).ponderado.quantidade, 0),
    ).toBe(mesDe(porStatus, mesFuturo).ponderado.quantidade);
  });

  it('caso 9: validação de período e flag desligada', async () => {
    const invertido = await forecast({ de: '2026-12', ate: '2026-11' });
    expect(invertido.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const longo = await forecast({ de: '2026-01', ate: '2028-01' });
    expect(longo.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const limite = await dadosDe(forecast({ de: '2026-01', ate: '2027-12' }));
    expect(limite.meses).toHaveLength(MESES_NO_ANO * DUAS);

    await TenantManagement.atualizarFeaturesTenant(tenantId, [CRM_FEATURES.PERMISSOES]);
    try {
      expect((await forecast()).status).toBe(HTTP_STATUS.FORBIDDEN);
      expect((await lista({ bloco: 'atrasadas' })).status).toBe(HTTP_STATUS.FORBIDDEN);
    } finally {
      await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
    }
    expect((await forecast()).status).toBe(HTTP_STATUS.OK);
  });

  it('caso 10: data prevista em massa atualiza as abertas e ignora ganha e inexistente', async () => {
    const a = await criar({ data: diaDoMes(mesFuturo) });
    const b = await criar({ data: diaDoMes(mesFuturo) });
    const ganha = await criar({ data: diaDoMes(mesFuturo) });
    await marcarGanha(ganha, `${mesAtual}-01 12:00:00`);
    const inexistente = randomUUID();
    const mesNovo = somarMeses(mesFuturo, DESLOCAMENTO_MES_NOVO);

    const resposta = await dadosDe(
      chamar('POST', '/crm/forecast/data-prevista', {
        oportunidadeIds: [a, b, ganha, inexistente],
        dataPrevistaFechamento: `${mesNovo}-20`,
      }),
    );
    expect(resposta.atualizadas).toBe(DUAS);
    expect(resposta.ignoradas).toHaveLength(DUAS);
    expect(resposta.ignoradas).toEqual(
      expect.arrayContaining([
        { id: ganha, motivo: 'NAO_ABERTA' },
        { id: inexistente, motivo: 'NAO_ENCONTRADA' },
      ]),
    );

    const dados = await dadosDe(forecast({ de: mesAtual, ate: mesNovo }));
    expect(mesDe(dados, mesNovo).ponderado.quantidade).toBe(DUAS);
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(0);
  });

  it('caso 10b: papel que não pode escrever Data prevista leva 403 e nada é gravado', async () => {
    const a = await criar({ data: diaDoMes(mesFuturo) });
    const mesNovo = somarMeses(mesFuturo, 1);
    await permissaoDoOperador('dataPrevistaFechamento', 'view');
    try {
      const negado = await chamar(
        'POST',
        '/crm/forecast/data-prevista',
        { oportunidadeIds: [a], dataPrevistaFechamento: `${mesNovo}-20` },
        operador,
      );
      expect(negado.status).toBe(HTTP_STATUS.FORBIDDEN);
    } finally {
      await permissaoDoOperador('dataPrevistaFechamento', 'edit');
    }
    const dados = await dadosDe(forecast({ de: mesAtual, ate: mesNovo }));
    expect(mesDe(dados, mesFuturo).ponderado.quantidade).toBe(1);
    expect(mesDe(dados, mesNovo).ponderado.quantidade).toBe(0);
  });

  it('caso 11: a lista traz as do mês com probabilidade efetiva e ponderado, e valida mes/bloco', async () => {
    const abertos = await abertosDeVendas();
    const data = diaDoMes(mesFuturo);
    const comOverride = await criar({
      valor: VALOR_GRANDE,
      data,
      status: abertos[0].key,
      override: PADRAO_EDITADO,
    });
    const semOverride = await criar({ valor: VALOR_PADRAO, data, status: abertos[1].key });
    const menor = await criar({ valor: VALOR_PEQUENO, data, status: abertos[0].key });
    const atrasada = await criar({ valor: VALOR_ATRASADA });
    await definirPrevista(atrasada, somarDias(hoje, -1));
    const ganha = await criar({ valor: VALOR_PADRAO });
    await marcarGanha(ganha, `${mesAtual}-01 12:00:00`);

    const doMes = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto' }));
    expect(doMes.total).toBe(QTD_DO_DONO);
    // Mesma data: valor maior primeiro.
    expect(doMes.itens.map((i) => i.id)).toEqual([comOverride, semOverride, menor]);
    expect(doMes.itens[0].probabilidadeEfetiva).toBe(PADRAO_EDITADO);
    expect(emCentavos(doMes.itens[0].ponderado)).toBe(
      ponderadoEmCentavos([{ c: centavos(VALOR_GRANDE), p: PADRAO_EDITADO }]),
    );
    expect(doMes.itens[1].probabilidadeEfetiva).toBe(abertos[1].probabilidadePadrao);
    expect(emCentavos(doMes.itens[1].ponderado)).toBe(
      ponderadoEmCentavos([{ c: centavos(VALOR_PADRAO), p: abertos[1].probabilidadePadrao }]),
    );
    expect(doMes.itens[0].dataPrevistaFechamento).toBe(data);

    const pagina = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto', tamanho: POR_PAGINA }));
    expect(pagina.itens).toHaveLength(POR_PAGINA);
    expect(pagina.total).toBe(QTD_DO_DONO);
    expect(pagina.pagina).toBe(1);

    const doBloco = await dadosDe(lista({ bloco: 'atrasadas' }));
    expect(doBloco.itens.map((i) => i.id)).toEqual([atrasada]);

    const realizadas = await dadosDe(lista({ mes: mesAtual, tipo: 'realizado' }));
    expect(realizadas.itens.map((i) => i.id)).toEqual([ganha]);

    const dois = await lista({ mes: mesFuturo, tipo: 'aberto', bloco: 'atrasadas' });
    expect(dois.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const nenhum = await lista({});
    expect(nenhum.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const semTipo = await lista({ mes: mesFuturo });
    expect(semTipo.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('antes do período: aberta de data futura anterior ao `de` conta só no bloco; no período padrão cai no mês dela', async () => {
    const aberto = (await abertosDeVendas())[0];
    const mesProximo = somarMeses(mesAtual, 1);
    const id = await criar({ valor: VALOR_PADRAO, data: diaDoMes(mesProximo), status: aberto.key });
    const de = somarMeses(mesAtual, MESES_A_FRENTE);
    const ate = somarMeses(mesAtual, MESES_ATE_ANTES_DO_PERIODO);

    const dados = await dadosDe(forecast({ de, ate }));
    const { antesDoPeriodo } = dados.blocos;
    expect(antesDoPeriodo.quantidade).toBe(1);
    expect(emCentavos(antesDoPeriodo.soma)).toBe(centavos(VALOR_PADRAO));
    expect(emCentavos(antesDoPeriodo.ponderado)).toBe(
      ponderadoEmCentavos([{ c: centavos(VALOR_PADRAO), p: aberto.probabilidadePadrao }]),
    );
    expect(dados.meses.reduce((total, mes) => total + mes.ponderado.quantidade, 0)).toBe(0);
    expect(dados.blocos.atrasadas.quantidade).toBe(0);

    const doBloco = await dadosDe(lista({ bloco: 'antes_do_periodo', de }));
    expect(doBloco.itens.map((i) => i.id)).toEqual([id]);
    expect(doBloco.total).toBe(1);

    const padrao = await dadosDe(forecast());
    expect(padrao.blocos.antesDoPeriodo.quantidade).toBe(0);
    expect(mesDe(padrao, mesProximo).ponderado.quantidade).toBe(1);
  });

  it('pessoa anonimizada continua no realizado do mês, com o nome anonimizado na lista', async () => {
    const ganha = await criar({ valor: VALOR_GRANDE });
    await marcarGanha(ganha, `${mesAtual}-01 12:00:00`);
    const [{ id: leadId }] = await prisma.$queryRaw`
      SELECT lead_id::text AS id FROM modulo_crm.crm_deal
      WHERE id = ${ganha}::uuid AND tenant_id = ${tenantId}::uuid
    `;

    await TenantManagement.atualizarFeaturesTenant(tenantId, [...COM_FORECAST, CRM_FEATURES.LGPD]);
    try {
      await ok(chamar('POST', `/crm/leads/${leadId}/anonimizar`));
    } finally {
      await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
    }
    await invalidarCache();

    const dados = await dadosDe(forecast({ de: mesAtual, ate: mesAtual }));
    expect(mesDe(dados, mesAtual).realizado).toEqual({ quantidade: 1, soma: VALOR_GRANDE });
    expect(dados.vazio).toBe(false);

    const realizadas = await dadosDe(lista({ mes: mesAtual, tipo: 'realizado' }));
    expect(realizadas.itens.map((i) => i.id)).toEqual([ganha]);
    expect(realizadas.itens[0].pessoa).toBe(ANONIMIZACAO.NOME);
    expect(realizadas.itens[0].pessoa).not.toBe('Pessoa');
  });

  it('filtro responsavelId: só as oportunidades do responsável entram, e vazio continua false', async () => {
    const data = diaDoMes(mesFuturo);
    await criar({ valor: VALOR_GRANDE, data, responsavelId: donoId });
    const doOperador = await criar({ valor: VALOR_PADRAO, data, responsavelId: operadorId });

    const query = { de: mesAtual, ate: mesFuturo };
    const todas = await dadosDe(forecast(query));
    expect(mesDe(todas, mesFuturo).ponderado.quantidade).toBe(DUAS);

    const filtrado = await dadosDe(forecast({ ...query, responsavelId: operadorId }));
    expect(filtrado.filtros.responsavelId).toBe(operadorId);
    expect(mesDe(filtrado, mesFuturo).ponderado.quantidade).toBe(1);
    expect(emCentavos(mesDe(filtrado, mesFuturo).melhorCaso.soma)).toBe(centavos(VALOR_PADRAO));
    expect(filtrado.vazio).toBe(false);

    const itens = await dadosDe(
      lista({ mes: mesFuturo, tipo: 'aberto', responsavelId: operadorId }),
    );
    expect(itens.itens.map((i) => i.id)).toEqual([doOperador]);
  });

  it('camposDesligados: Data prevista desligada aparece no aviso e some dos itens da lista', async () => {
    await criar({ valor: VALOR_PADRAO, data: diaDoMes(mesFuturo) });
    const campo = (await listarConfiguracaoCampos(tenantId)).find(
      (c) => c.chave === 'dataPrevistaFechamento',
    );

    await atualizarConfiguracaoCampo(tenantId, campo.id, { visibilidade: visibilidadeEm(false) });
    try {
      const dados = await dadosDe(forecast({ de: mesAtual, ate: mesFuturo }));
      expect(dados.camposDesligados).toContain('dataPrevistaFechamento');

      const itens = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto' }));
      expect(itens.itens).toHaveLength(1);
      for (const item of itens.itens) expect(item).not.toHaveProperty('dataPrevistaFechamento');
    } finally {
      await atualizarConfiguracaoCampo(tenantId, campo.id, { visibilidade: visibilidadeEm(true) });
    }
    const religado = await dadosDe(forecast({ de: mesAtual, ate: mesFuturo }));
    expect(religado.camposDesligados).not.toContain('dataPrevistaFechamento');
  });

  it('oportunidade arquivada e pessoa arquivada ficam fora do forecast', async () => {
    const data = diaDoMes(mesFuturo);
    const arquivada = await criar({ valor: VALOR_PADRAO, data });
    const pessoaArquivada = await criar({ valor: VALOR_GRANDE, data });
    const [{ id: leadId }] = await prisma.$queryRaw`
      SELECT lead_id::text AS id FROM modulo_crm.crm_deal
      WHERE id = ${pessoaArquivada}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    const query = { de: mesAtual, ate: mesFuturo };
    const antes = await dadosDe(forecast(query));
    expect(mesDe(antes, mesFuturo).ponderado.quantidade).toBe(DUAS);

    await ok(chamar('POST', `/crm/oportunidades/${arquivada}/arquivar`));
    await TenantManagement.atualizarFeaturesTenant(tenantId, [
      ...COM_FORECAST,
      CRM_FEATURES.ARQUIVO,
    ]);
    try {
      await ok(chamar('POST', `/crm/leads/${leadId}/arquivar`));
    } finally {
      await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
    }

    const depois = await dadosDe(forecast(query));
    expect(mesDe(depois, mesFuturo).ponderado.quantidade).toBe(0);
    const itens = await dadosDe(lista({ mes: mesFuturo, tipo: 'aberto' }));
    expect(itens.total).toBe(0);
  });
});
