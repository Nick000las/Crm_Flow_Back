import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { TenantManagement } from '#core/tenant/management.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { CATEGORIAS_STATUS, CRM_FEATURES, MODULO_CRM, TIPOS_PIPELINE } from '../constants.js';
import { CICLOS_DE_VIDA } from '../constants/oportunidades.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FC4 (docs/produto/crm-oportunidades-e-pipelines.md): colunas do ciclo de
 * vida na tabela de leads (`ciclo_de_vida`, `cliente_desde`, `ultima_compra`,
 * `oportunidades_abertas`) e os filtros delas, só pela HTTP. GRAVA no banco de
 * `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`,
 * num banco de dev.
 *
 * Ganhar e reabrir é pelo PATCH de status. O `won_at` só é fixado direto no
 * banco quando o teste precisa de um instante exato (borda de fuso, ordem das
 * compras). O fuso do tenant é America/Sao_Paulo (UTC-3, sem horário de verão).
 * A automação de atendimento do pipeline Atendimento é desligada: sem ela, a
 * venda ganha criaria uma oportunidade aberta e mexeria nas contagens.
 *
 * Cada teste começa sem pessoas nem oportunidades (`beforeEach`).
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const TAMANHO_PAGINA = 100;
const DUAS = 2;
const TRES = 3;

const COMPRA_ANTIGA = '2026-01-10 12:00:00';
const COMPRA_ANTIGA_ISO = '2026-01-10T12:00:00.000Z';
const COMPRA_MARCO = '2026-03-10 12:00:00';
const COMPRA_SETEMBRO = '2026-09-15 12:00:00';
// 23:30 de 31/10 em São Paulo e 00:30 de 01/11, na ordem.
const BORDA_ANTES = '2026-11-01 02:30:00';
const BORDA_DEPOIS = '2026-11-01 03:30:00';
const BORDA_ANTES_ISO = '2026-11-01T02:30:00.000Z';
const DIA_ANTES_DA_BORDA = '2026-10-31';
const DIA_DEPOIS_DA_BORDA = '2026-11-01';
const DIA_DA_COMPRA_MARCO = '2026-03-10';
const SETEMBRO_DE = '2026-09-01';
const SETEMBRO_ATE = '2026-09-30';

const CAMPO_DAS_DATAS = 'dataConversao';
const COLUNAS = ['ciclo_de_vida', 'cliente_desde', 'ultima_compra', 'oportunidades_abertas'];
const DATAS = ['cliente_desde', 'ultima_compra'];
const CONTEXTOS_DO_CAMPO = ['create_form', 'detail', 'table', 'filter'];
const visibilidadeEm = (visivel) =>
  Object.fromEntries(CONTEXTOS_DO_CAMPO.map((contexto) => [contexto, visivel]));

rodar('FC4: ciclo de vida na tabela de leads (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  const COM_ARQUIVO = [CRM_FEATURES.PERMISSOES, CRM_FEATURES.ARQUIVO];
  let app;
  let vendas;
  let atendimento;
  let oculto;
  let abertoKey;

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
  const statusDe = (pipeline, categoria) =>
    pipeline.status.find((s) => s.category === categoria && s.ativo !== false).key;

  const lerLead = (id, quem) => ok(chamar('GET', `/crm/leads/${id}`, undefined, quem));
  const buscar = (filtro = {}, quem) =>
    chamar(
      'POST',
      '/crm/leads/search',
      { ...filtro, paginacao: { tamanho: TAMANHO_PAGINA } },
      quem,
    );
  /** Nomes (ordenados) das pessoas que o filtro devolve. */
  const nomesDaBusca = async (filtro, quem) =>
    (await ok(buscar(filtro, quem))).itens.map((l) => l.nome).sort();
  const nomes = (...lista) => lista.sort();
  const instante = (valor) => (valor ? new Date(valor).toISOString() : null);

  /** O que o teste compara de uma pessoa: as 4 colunas, com as datas como ISO. */
  const colunasDe = (lead) => ({
    ciclo: lead.ciclo_de_vida,
    desde: instante(lead.cliente_desde),
    ultima: instante(lead.ultima_compra),
    abertas: lead.oportunidades_abertas,
  });

  /**
   * Pessoa nova pela API. Criar a pessoa já cria uma oportunidade aberta em
   * Vendas; com `semOportunidade` ela vai pra lixeira (a pessoa vira `lead`).
   */
  async function pessoa(nome, { semOportunidade = false } = {}) {
    const lead = await ok(
      chamar('POST', '/crm/leads', { nome, email: `${randomUUID()}@smoke.test` }),
      HTTP_STATUS.CREATED,
    );
    const [inicial] = await ok(chamar('GET', `/crm/leads/${lead.id}/oportunidades`));

    if (semOportunidade) {
      await ok(chamar('POST', `/crm/oportunidades/${inicial.id}/excluir`));

      return { id: lead.id };
    }

    return { id: lead.id, dealId: inicial.id };
  }

  async function novaOportunidade(leadId, { pipeline = vendas, status } = {}) {
    const criada = await ok(
      chamar('POST', `/crm/leads/${leadId}/oportunidades`, {
        pipelineId: pipeline.id,
        ...(status && { status }),
      }),
      HTTP_STATUS.CREATED,
    );

    return criada.id;
  }

  const mudarStatus = (dealId, status, extra = {}) =>
    ok(chamar('PATCH', `/crm/oportunidades/${dealId}/status`, { status, ...extra }));
  const ganhar = (dealId, pipeline = vendas) =>
    mudarStatus(dealId, statusDe(pipeline, CATEGORIAS_STATUS.GANHO));

  /** Fixa o instante da ganha (timestamp sem fuso, em UTC). */
  async function fixarGanha(dealId, ganhaEmUtc) {
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal SET won_at = ${ganhaEmUtc}::timestamp
      WHERE id = ${dealId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  /** Ganha pela rota e depois fixa o instante. */
  async function ganharEm(dealId, quando, pipeline = vendas) {
    await ganhar(dealId, pipeline);
    await fixarGanha(dealId, quando);
  }

  const arquivar = (dealId) => ok(chamar('POST', `/crm/oportunidades/${dealId}/arquivar`));

  const gravado = async (leadId) => {
    const [linha] = await prisma.$queryRaw`
      SELECT lifecycle_stage FROM modulo_crm.leads
      WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `;

    return linha.lifecycle_stage;
  };

  /** Os campos de `fields` do erro 400 (o nome pode vir com prefixo, como `filtros.`). */
  const camposDoErro = (corpo) =>
    Object.keys(corpo?.error?.fields ?? corpo?.fields ?? {}).map((chave) => chave.split('.').pop());

  /** Liga ou desliga o campo Data de convers�o do tenant (vem desligado de f�brica). */
  async function campoDasDatas(visivel) {
    const campo = (await listarConfiguracaoCampos(tenantId)).find(
      (c) => c.chave === CAMPO_DAS_DATAS,
    );

    await atualizarConfiguracaoCampo(tenantId, campo.id, { visibilidade: visibilidadeEm(visivel) });
  }

  async function permissaoDoOperador(chave, acesso) {
    const campo = (await listarConfiguracaoCampos(tenantId)).find((c) => c.chave === chave);

    await ok(chamar('PUT', '/crm/configuracoes/permissoes', { OPERADOR: { [campo.id]: acesso } }));
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE ciclo FC4',
        subdomain: `smoke-fc4-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
    await campoDasDatas(true);

    app = await buildApp({
      config: {
        APP_NAME: 'crm-ciclo-fc4',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });

    await TenantManagement.atualizarFeaturesTenant(tenantId, COM_ARQUIVO);

    const todos = await pipelines();

    vendas = todos.find((p) => p.tipo === TIPOS_PIPELINE.VENDAS && p.padrao);
    atendimento = todos.find((p) => p.tipo === TIPOS_PIPELINE.ATENDIMENTO);
    abertoKey = statusDe(vendas, CATEGORIAS_STATUS.ABERTO);

    await ok(
      chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
        automacao: { ativa: false },
      }),
    );

    await ok(
      chamar('POST', '/crm/configuracoes/pipelines', {
        nome: 'Vendas oculto',
        tipo: TIPOS_PIPELINE.VENDAS,
      }),
      HTTP_STATUS.CREATED,
    );

    oculto = (await pipelines()).find((p) => p.nome === 'Vendas oculto');

    await ok(
      chamar('PUT', `/crm/configuracoes/pipelines/${oculto.id}`, { visivelOperador: false }),
    );
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  it('caso 1: ganhar a primeira preenche as duas datas; a segunda mexe só na última compra; reabrir limpa', async () => {
    const { id, dealId } = await pessoa('Cliente');
    const antes = colunasDe(await lerLead(id));

    expect(antes).toEqual({
      ciclo: CICLOS_DE_VIDA.OPORTUNIDADE,
      desde: null,
      ultima: null,
      abertas: 1,
    });

    await ganhar(dealId);

    const primeira = colunasDe(await lerLead(id));

    expect(primeira.ciclo).toBe(CICLOS_DE_VIDA.CLIENTE);
    expect(primeira.desde).not.toBeNull();
    expect(primeira.ultima).toBe(primeira.desde);
    expect(primeira.abertas).toBe(0);

    // A primeira compra passa a ser antiga; a segunda é a de agora.
    await fixarGanha(dealId, COMPRA_ANTIGA);

    const segundaId = await novaOportunidade(id);

    await ganhar(segundaId);

    const depois = colunasDe(await lerLead(id));

    expect(depois.ciclo).toBe(CICLOS_DE_VIDA.CLIENTE);
    expect(depois.desde).toBe(COMPRA_ANTIGA_ISO);
    expect(depois.ultima).not.toBe(COMPRA_ANTIGA_ISO);
    expect(new Date(depois.ultima).getTime()).toBeGreaterThan(new Date(depois.desde).getTime());

    // Reabrir a segunda: só a última compra volta pra primeira.
    await mudarStatus(segundaId, abertoKey);

    const reaberta = colunasDe(await lerLead(id));

    expect(reaberta).toEqual({
      ciclo: CICLOS_DE_VIDA.CLIENTE,
      desde: COMPRA_ANTIGA_ISO,
      ultima: COMPRA_ANTIGA_ISO,
      abertas: 1,
    });

    // Reabrir a única ganha limpa as duas e o ciclo volta a oportunidade.
    await mudarStatus(dealId, abertoKey);

    const semGanhas = colunasDe(await lerLead(id));

    expect(semGanhas).toEqual({
      ciclo: CICLOS_DE_VIDA.OPORTUNIDADE,
      desde: null,
      ultima: null,
      abertas: DUAS,
    });

    expect(await gravado(id)).toBe(CICLOS_DE_VIDA.OPORTUNIDADE);

    // Sem aberta (as duas arquivadas), o ciclo volta a lead.
    await arquivar(dealId);
    await arquivar(segundaId);

    const lead = colunasDe(await lerLead(id));

    expect(lead).toEqual({ ciclo: CICLOS_DE_VIDA.LEAD, desde: null, ultima: null, abertas: 0 });
    expect(await gravado(id)).toBe(CICLOS_DE_VIDA.LEAD);
  });

  it('caso 2: sem pipeline oculto, o ciclo calculado é o lifecycle_stage gravado (GET, lista e busca)', async () => {
    const semOportunidade = await pessoa('Sem oportunidade', { semOportunidade: true });
    const aberta = await pessoa('Aberta');
    const arquivada = await pessoa('Aberta arquivada');

    await arquivar(arquivada.dealId);

    const ganha = await pessoa('Ganha');

    await ganhar(ganha.dealId);

    const perdida = await pessoa('Perdida');

    await mudarStatus(perdida.dealId, 'perdido', { motivoPerda: 'Sem orçamento' });

    const ganhaEPerdida = await pessoa('Ganha e perdida');

    await ganhar(ganhaEPerdida.dealId);

    const outraPerdida = await novaOportunidade(ganhaEPerdida.id);

    await mudarStatus(outraPerdida, 'perdido', { motivoPerda: 'Sem orçamento' });

    const esperado = [
      [semOportunidade, CICLOS_DE_VIDA.LEAD, 0],
      [aberta, CICLOS_DE_VIDA.OPORTUNIDADE, 1],
      [arquivada, CICLOS_DE_VIDA.LEAD, 0],
      [ganha, CICLOS_DE_VIDA.CLIENTE, 0],
      [perdida, CICLOS_DE_VIDA.LEAD, 0],
      [ganhaEPerdida, CICLOS_DE_VIDA.CLIENTE, 0],
    ];
    const porBusca = new Map((await ok(buscar())).itens.map((lead) => [lead.id, colunasDe(lead)]));
    const porLista = new Map(
      (await ok(chamar('GET', `/crm/leads?tamanho=${TAMANHO_PAGINA}`))).itens.map((lead) => [
        lead.id,
        colunasDe(lead),
      ]),
    );

    for (const [{ id }, ciclo, abertas] of esperado) {
      const doGet = colunasDe(await lerLead(id));

      expect(doGet.ciclo, id).toBe(ciclo);
      expect(doGet.ciclo, `gravado ${id}`).toBe(await gravado(id));
      expect(doGet.abertas, id).toBe(abertas);
      expect(porBusca.get(id), `busca ${id}`).toEqual(doGet);
      expect(porLista.get(id), `lista ${id}`).toEqual(doGet);
    }
  });

  it('caso 3: o OPERADOR não enxerga venda nem aberta de pipeline oculto (colunas e filtros)', async () => {
    // Pessoa só com oportunidade oculta some do OPERADOR (404); por isso cada
    // uma ganha uma perdida em Vendas (não conta em nada), que a mantém visível.
    const comPerdidaVisivel = async (nome) => {
      const nova = await pessoa(nome, { semOportunidade: true });
      const perdida = await novaOportunidade(nova.id);

      await mudarStatus(perdida, 'perdido', { motivoPerda: 'Sem orçamento' });

      return nova;
    };
    // Venda só no pipeline oculto.
    const vendaOculta = await comPerdidaVisivel('Venda oculta');

    await ganharEm(
      await novaOportunidade(vendaOculta.id, { pipeline: oculto }),
      COMPRA_MARCO,
      oculto,
    );

    // Uma aberta visível e uma aberta oculta.
    const mista = await pessoa('Mista');

    await novaOportunidade(mista.id, { pipeline: oculto });

    // Só aberta no oculto.
    const soAbertaOculta = await comPerdidaVisivel('So aberta oculta');

    await novaOportunidade(soAbertaOculta.id, { pipeline: oculto });

    // O DONO vê tudo.
    expect(colunasDe(await lerLead(vendaOculta.id))).toEqual({
      ciclo: CICLOS_DE_VIDA.CLIENTE,
      desde: `${COMPRA_MARCO.replace(' ', 'T')}.000Z`,
      ultima: `${COMPRA_MARCO.replace(' ', 'T')}.000Z`,
      abertas: 0,
    });

    expect(colunasDe(await lerLead(mista.id)).abertas).toBe(DUAS);

    expect(colunasDe(await lerLead(soAbertaOculta.id))).toMatchObject({
      ciclo: CICLOS_DE_VIDA.OPORTUNIDADE,
      abertas: 1,
    });

    // O OPERADOR não vê a venda oculta em nenhuma das 4 colunas.
    expect(colunasDe(await lerLead(vendaOculta.id, operador))).toEqual({
      ciclo: CICLOS_DE_VIDA.LEAD,
      desde: null,
      ultima: null,
      abertas: 0,
    });

    const daLista = (
      await ok(chamar('GET', `/crm/leads?tamanho=${TAMANHO_PAGINA}`, undefined, operador))
    ).itens;
    const daBusca = (await ok(buscar({}, operador))).itens;

    for (const itens of [daLista, daBusca]) {
      const vistas = new Map(itens.map((lead) => [lead.nome, colunasDe(lead)]));

      expect(vistas.get('Venda oculta')).toEqual({
        ciclo: CICLOS_DE_VIDA.LEAD,
        desde: null,
        ultima: null,
        abertas: 0,
      });

      expect(vistas.get('Mista')).toMatchObject({ ciclo: CICLOS_DE_VIDA.OPORTUNIDADE, abertas: 1 });

      expect(vistas.get('So aberta oculta')).toMatchObject({
        ciclo: CICLOS_DE_VIDA.LEAD,
        abertas: 0,
      });
    }

    // Filtros: cliente só pro DONO.
    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.CLIENTE] })).toEqual(['Venda oculta']);
    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.CLIENTE] }, operador)).toEqual([]);
    expect(await nomesDaBusca({ clienteDesdeDe: DIA_DA_COMPRA_MARCO })).toEqual(['Venda oculta']);
    expect(await nomesDaBusca({ clienteDesdeDe: DIA_DA_COMPRA_MARCO }, operador)).toEqual([]);
    expect(await nomesDaBusca({ ultimaCompraAte: DIA_DA_COMPRA_MARCO }, operador)).toEqual([]);

    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.LEAD] }, operador)).toEqual(
      nomes('Venda oculta', 'So aberta oculta'),
    );

    // Abertas: a oculta não conta, nem no Min.
    expect(await nomesDaBusca({ oportunidadesAbertasMin: DUAS })).toEqual(['Mista']);
    expect(await nomesDaBusca({ oportunidadesAbertasMin: DUAS }, operador)).toEqual([]);
    expect(await nomesDaBusca({ oportunidadesAbertasMin: 1 }, operador)).toEqual(['Mista']);

    expect(await nomesDaBusca({ oportunidadesAbertasMax: 0 }, operador)).toEqual(
      nomes('Venda oculta', 'So aberta oculta'),
    );
  });

  it('caso 4: aberta arquivada não conta em abertas; ganha em pipeline de atendimento não faz cliente', async () => {
    const arquivada = await pessoa('Arquivada');

    await novaOportunidade(arquivada.id);
    await arquivar(arquivada.dealId);

    expect(colunasDe(await lerLead(arquivada.id))).toMatchObject({
      ciclo: CICLOS_DE_VIDA.OPORTUNIDADE,
      abertas: 1,
    });

    const servico = await pessoa('Servico', { semOportunidade: true });
    const dealServico = await novaOportunidade(servico.id, { pipeline: atendimento });

    // Aberta em atendimento conta como oportunidade aberta (qualquer tipo de pipeline).
    expect(colunasDe(await lerLead(servico.id))).toMatchObject({
      ciclo: CICLOS_DE_VIDA.OPORTUNIDADE,
      abertas: 1,
    });

    await ganhar(dealServico, atendimento);

    expect(colunasDe(await lerLead(servico.id))).toEqual({
      ciclo: CICLOS_DE_VIDA.LEAD,
      desde: null,
      ultima: null,
      abertas: 0,
    });

    expect(await gravado(servico.id)).toBe(CICLOS_DE_VIDA.LEAD);

    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.CLIENTE] })).toEqual([]);
    expect(await nomesDaBusca({ oportunidadesAbertasMax: 0 })).toEqual(['Servico']);
  });

  it('caso 5: cada filtro devolve as pessoas certas, com a borda do fuso', async () => {
    // A: ganha às 23:30 de 31/10 em São Paulo. B: ganha às 00:30 de 01/11.
    const a = await pessoa('A borda antes');

    await ganharEm(a.dealId, BORDA_ANTES);

    const b = await pessoa('B borda depois');

    await ganharEm(b.dealId, BORDA_DEPOIS);

    // C: duas compras, em março e em setembro.
    const c = await pessoa('C duas compras');

    await ganharEm(c.dealId, COMPRA_MARCO);
    await ganharEm(await novaOportunidade(c.id), COMPRA_SETEMBRO);

    // D: duas abertas. E: uma aberta. F: sem oportunidade.
    const d = await pessoa('D duas abertas');

    await novaOportunidade(d.id);
    await pessoa('E uma aberta');
    await pessoa('F lead', { semOportunidade: true });

    const doC = colunasDe(await lerLead(c.id));

    expect(doC.desde).toBe(`${COMPRA_MARCO.replace(' ', 'T')}.000Z`);
    expect(doC.ultima).toBe(`${COMPRA_SETEMBRO.replace(' ', 'T')}.000Z`);
    expect(colunasDe(await lerLead(a.id)).desde).toBe(BORDA_ANTES_ISO);

    const clientes = nomes('A borda antes', 'B borda depois', 'C duas compras');

    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.CLIENTE] })).toEqual(clientes);

    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.OPORTUNIDADE] })).toEqual(
      nomes('D duas abertas', 'E uma aberta'),
    );

    expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.LEAD] })).toEqual(['F lead']);

    expect(
      await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.LEAD, CICLOS_DE_VIDA.OPORTUNIDADE] }),
    ).toEqual(nomes('D duas abertas', 'E uma aberta', 'F lead'));

    // Borda do fuso: 02:30Z de 01/11 é 31/10 em São Paulo.
    expect(await nomesDaBusca({ clienteDesdeAte: DIA_ANTES_DA_BORDA })).toEqual(
      nomes('A borda antes', 'C duas compras'),
    );

    expect(await nomesDaBusca({ clienteDesdeDe: DIA_DEPOIS_DA_BORDA })).toEqual(['B borda depois']);

    expect(
      await nomesDaBusca({
        clienteDesdeDe: DIA_ANTES_DA_BORDA,
        clienteDesdeAte: DIA_ANTES_DA_BORDA,
      }),
    ).toEqual(['A borda antes']);

    expect(
      await nomesDaBusca({
        clienteDesdeDe: DIA_DA_COMPRA_MARCO,
        clienteDesdeAte: DIA_DA_COMPRA_MARCO,
      }),
    ).toEqual(['C duas compras']);

    // Última compra: C comprou de novo em setembro; o "cliente desde" dele é março.
    expect(
      await nomesDaBusca({ ultimaCompraDe: SETEMBRO_DE, ultimaCompraAte: SETEMBRO_ATE }),
    ).toEqual(['C duas compras']);

    expect(await nomesDaBusca({ ultimaCompraAte: DIA_ANTES_DA_BORDA })).toEqual(
      nomes('A borda antes', 'C duas compras'),
    );

    expect(await nomesDaBusca({ ultimaCompraDe: DIA_DEPOIS_DA_BORDA })).toEqual(['B borda depois']);
    expect(await nomesDaBusca({ ultimaCompraAte: DIA_DA_COMPRA_MARCO })).toEqual([]);

    // Abertas.
    expect(await nomesDaBusca({ oportunidadesAbertasMin: DUAS })).toEqual(['D duas abertas']);

    expect(await nomesDaBusca({ oportunidadesAbertasMin: 1, oportunidadesAbertasMax: 1 })).toEqual([
      'E uma aberta',
    ]);

    expect(await nomesDaBusca({ oportunidadesAbertasMax: 0 })).toEqual(
      nomes('A borda antes', 'B borda depois', 'C duas compras', 'F lead'),
    );

    expect(
      await nomesDaBusca({
        cicloDeVida: [CICLOS_DE_VIDA.OPORTUNIDADE],
        oportunidadesAbertasMin: DUAS,
      }),
    ).toEqual(['D duas abertas']);

    expect(clientes).toHaveLength(TRES);
  });

  it('caso 6: validação dos filtros', async () => {
    const deAteInvertidos = [
      ['clienteDesdeDe', 'clienteDesdeAte'],
      ['ultimaCompraDe', 'ultimaCompraAte'],
    ];

    for (const [de, ate] of deAteInvertidos) {
      const resposta = await buscar({ [de]: DIA_DEPOIS_DA_BORDA, [ate]: DIA_ANTES_DA_BORDA });

      expect(resposta.status, de).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(camposDoErro(resposta.corpo), de).toContain(de);
    }

    const minMaior = await buscar({ oportunidadesAbertasMin: TRES, oportunidadesAbertasMax: 1 });

    expect(minMaior.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(camposDoErro(minMaior.corpo)).toContain('oportunidadesAbertasMin');

    const cicloInvalido = await buscar({ cicloDeVida: ['xpto'] });

    expect(cicloInvalido.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(JSON.stringify(cicloInvalido.corpo)).toMatch(/cicloDeVida/);

    // De igual a Ate (um dia só) é válido.
    expect(
      (await buscar({ clienteDesdeDe: DIA_ANTES_DA_BORDA, clienteDesdeAte: DIA_ANTES_DA_BORDA }))
        .status,
    ).toBe(HTTP_STATUS.OK);
  });

  it('caso 7 (M13): sem o campo Data de conversão, as duas datas somem e o filtro delas dá 400', async () => {
    const { id, dealId } = await pessoa('Comprou');

    await ganharEm(dealId, COMPRA_MARCO);

    const noDono = await lerLead(id);

    for (const coluna of DATAS) {
      expect(noDono, coluna).toHaveProperty(coluna);
    }

    // Campo desligado no tenant: nem o DONO recebe as datas nem filtra por elas.
    await campoDasDatas(false);

    try {
      const desligado = await lerLead(id);

      for (const coluna of DATAS) {
        expect(desligado, coluna).not.toHaveProperty(coluna);
      }

      expect(desligado.ciclo_de_vida).toBe(CICLOS_DE_VIDA.CLIENTE);

      const filtrado = await buscar({ clienteDesdeDe: DIA_DA_COMPRA_MARCO });

      expect(filtrado.status).toBe(HTTP_STATUS.BAD_REQUEST);
    } finally {
      await campoDasDatas(true);
    }

    await permissaoDoOperador(CAMPO_DAS_DATAS, 'hidden');

    try {
      const doOperador = await lerLead(id, operador);

      for (const coluna of DATAS) {
        expect(doOperador, coluna).not.toHaveProperty(coluna);
      }

      expect(doOperador.ciclo_de_vida).toBe(CICLOS_DE_VIDA.CLIENTE);
      expect(doOperador.oportunidades_abertas).toBe(0);

      const naBusca = (await ok(buscar({}, operador))).itens.find((l) => l.id === id);

      for (const coluna of DATAS) {
        expect(naBusca, coluna).not.toHaveProperty(coluna);
      }

      expect(naBusca.ciclo_de_vida).toBe(CICLOS_DE_VIDA.CLIENTE);

      for (const chave of [
        'clienteDesdeDe',
        'clienteDesdeAte',
        'ultimaCompraDe',
        'ultimaCompraAte',
      ]) {
        const resposta = await buscar({ [chave]: DIA_DA_COMPRA_MARCO }, operador);

        expect(resposta.status, chave).toBe(HTTP_STATUS.BAD_REQUEST);
        expect(camposDoErro(resposta.corpo), chave).toContain(chave);
      }

      // Ciclo e abertas não dependem do campo.
      expect(await nomesDaBusca({ cicloDeVida: [CICLOS_DE_VIDA.CLIENTE] }, operador)).toEqual([
        'Comprou',
      ]);

      expect(await nomesDaBusca({ oportunidadesAbertasMax: 0 }, operador)).toEqual(['Comprou']);
      // O DONO continua vendo e filtrando.
      expect(await nomesDaBusca({ clienteDesdeDe: DIA_DA_COMPRA_MARCO })).toEqual(['Comprou']);
    } finally {
      await permissaoDoOperador(CAMPO_DAS_DATAS, 'edit');
    }

    const religado = await lerLead(id, operador);

    for (const coluna of DATAS) {
      expect(religado, coluna).toHaveProperty(coluna);
    }
  });

  it('as 4 colunas existem na resposta (GET, lista e busca) mesmo sem oportunidade', async () => {
    const { id } = await pessoa('Sozinha', { semOportunidade: true });

    for (const lead of [
      await lerLead(id),
      (await ok(chamar('GET', '/crm/leads'))).itens.find((l) => l.id === id),
      (await ok(buscar())).itens.find((l) => l.id === id),
    ]) {
      for (const coluna of COLUNAS) {
        expect(lead, coluna).toHaveProperty(coluna);
      }

      expect(colunasDe(lead)).toEqual({
        ciclo: CICLOS_DE_VIDA.LEAD,
        desde: null,
        ultima: null,
        abertas: 0,
      });
    }
  });
});
