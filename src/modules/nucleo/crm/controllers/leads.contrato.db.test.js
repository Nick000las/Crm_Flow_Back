import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { transicionarStatus, buscarImportJob } from '../adapters/import-jobs.repository.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { processarImportacao, validarImportacao } from '../services/import.service.js';
import { gerarPlanilha } from '../services/planilha.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * Contrato de `/crm/leads` para a transição do M2.5 (F0): o que a API entrega
 * hoje, pela rota, sem olhar a tabela. Quando os campos comerciais passarem
 * para a oportunidade, estes testes continuam iguais: se um deles precisar
 * mudar, o contrato com o front mudou, e isso é decisão, não ajuste de teste.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const VALOR_ALTO = 900;
const VALOR_BAIXO = 100;
const VALOR_EDITADO = 250.5;
const PROBABILIDADE = 70;

/** Campos opcionais que dependem de o tenant ligá-los; com isso, entram no contrato. */
const CAMPOS_OPCIONAIS = Object.freeze({
  dataConversao: 'data_conversao',
  probabilidadeFechamento: 'probabilidade_fechamento',
  dataPrevistaFechamento: 'data_prevista_fechamento',
  motivoPerda: 'motivo_perda',
});

/** Chaves do lead que a tabela e a ficha do front consomem. */
const CAMPOS_COMERCIAIS = Object.freeze([
  'status',
  'valor',
  'funil_estagio_id',
  'estagio_nome',
  ...Object.values(CAMPOS_OPCIONAIS),
]);

rodar('contrato de /crm/leads na transição (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let app;
  let statusAberto;
  let statusFechado;

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE contrato',
        subdomain: `smoke-contrato-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });
    await prisma.usuario.create({
      data: {
        id: donoId,
        tenantId,
        nome: 'Dono',
        email: `smoke-${donoId}@smoke.test`,
        senhaHash: 'test',
        role: 'DONO',
      },
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.createMany({
      data: [
        CRM_FEATURES.MASSA,
        CRM_FEATURES.DUPLICIDADE,
        CRM_FEATURES.LGPD,
        CRM_FEATURES.TIMELINE,
        CRM_FEATURES.ATIVIDADES,
        CRM_FEATURES.LISTAS,
      ].map((featureKey) => ({ tenantId, moduleKey: MODULO_CRM, featureKey })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    const campos = await listarConfiguracaoCampos(tenantId);
    for (const campo of campos.filter(({ chave }) => chave in CAMPOS_OPCIONAIS)) {
      await atualizarConfiguracaoCampo(tenantId, campo.id, {
        visibilidade: { create_form: true, detail: true, table: true, filter: true },
      });
    }
    app = await buildApp({
      config: {
        APP_NAME: 'crm-contrato',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });

    const opcoes = await prisma.$queryRaw`
      SELECT key, category FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'status' ORDER BY position
    `;
    statusAberto = opcoes.find((opcao) => opcao.category === 'aberto').key;
    statusFechado = opcoes.find((opcao) => opcao.category === 'perdido').key;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  async function chamar(method, url, payload) {
    const token = app.jwt.access.sign({ tenantId, userId: donoId, role: 'DONO' });
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: resposta.statusCode, corpo: resposta.body };
  }
  const json = (resposta) => JSON.parse(resposta.corpo);

  async function criar(campos) {
    const resposta = await chamar('POST', '/crm/leads', {
      email: `${randomUUID()}@smoke.test`,
      ...campos,
    });
    expect(resposta.status, resposta.corpo).toBe(HTTP_STATUS.CREATED);
    return json(resposta).data.id;
  }
  const ler = async (id) => json(await chamar('GET', `/crm/leads/${id}`)).data;

  it('criar e ler: todo campo comercial vem no lead, com o mesmo nome', async () => {
    const dataPrevista = '2026-12-20';
    const id = await criar({
      nome: 'Contrato Completo',
      status: statusAberto,
      valor: VALOR_ALTO,
      probabilidadeFechamento: PROBABILIDADE,
      dataPrevistaFechamento: dataPrevista,
    });

    const lead = await ler(id);

    for (const campo of CAMPOS_COMERCIAIS) {
      expect(lead).toHaveProperty(campo);
    }
    expect(lead).toMatchObject({
      nome: 'Contrato Completo',
      status: statusAberto,
    });
    expect(Number(lead.valor)).toBe(VALOR_ALTO);
    expect(Number(lead.probabilidade_fechamento)).toBe(PROBABILIDADE);
    expect(String(lead.data_prevista_fechamento)).toContain(dataPrevista);
  });

  it('lead sem dado comercial nasce com tudo nulo, inclusive o status', async () => {
    const lead = await ler(await criar({ nome: 'Contrato Mínimo' }));
    expect(lead.status).toBeNull();
    expect(lead.valor).toBeNull();
    expect(lead.motivo_perda).toBeNull();
    expect(lead.funil_estagio_id).toBeNull();
  });

  it('status fora da lista do tenant é 400 no campo status', async () => {
    const resposta = await chamar('POST', '/crm/leads', {
      nome: 'Status inválido',
      email: `${randomUUID()}@smoke.test`,
      status: 'nao-existe',
    });
    expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(json(resposta).error.fields).toHaveProperty('status');
  });

  it('editar: omitir mantém, null limpa, e o histórico registra o diff', async () => {
    const id = await criar({ nome: 'Contrato Edição', status: statusAberto, valor: VALOR_ALTO });

    const editado = await chamar('PUT', `/crm/leads/${id}`, { valor: VALOR_EDITADO });
    expect(editado.status, editado.corpo).toBe(HTTP_STATUS.OK);
    expect(Number(json(editado).data.valor)).toBe(VALOR_EDITADO);
    expect((await ler(id)).status).toBe(statusAberto);

    await chamar('PUT', `/crm/leads/${id}`, { valor: null });
    expect((await ler(id)).valor).toBeNull();

    const historico = await chamar('GET', `/crm/leads/${id}/historico`);
    expect(historico.status, historico.corpo).toBe(HTTP_STATUS.OK);
    expect(historico.corpo).toContain('valor');
  });

  it('mudar status com motivo: os dois aparecem no lead', async () => {
    const id = await criar({ nome: 'Contrato Perda', status: statusAberto });
    const motivos = await prisma.$queryRaw`
      SELECT key FROM modulo_crm.crm_option
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'motivo_perda' ORDER BY position LIMIT 1
    `;

    const editado = await chamar('PUT', `/crm/leads/${id}`, {
      status: statusFechado,
      motivoPerda: motivos[0].key,
    });

    expect(editado.status, editado.corpo).toBe(HTTP_STATUS.OK);
    expect(await ler(id)).toMatchObject({
      status: statusFechado,
      motivo_perda: motivos[0].key,
    });
  });

  it('mudar status conta como interação; editar outro campo, não', async () => {
    const id = await criar({ nome: 'Contrato Interação', status: statusAberto });
    const antes = (await ler(id)).ultima_interacao_em;

    await chamar('PUT', `/crm/leads/${id}`, { valor: VALOR_BAIXO });
    expect((await ler(id)).ultima_interacao_em).toBe(antes);

    await chamar('PUT', `/crm/leads/${id}`, { status: statusFechado });
    expect((await ler(id)).ultima_interacao_em).not.toBe(antes);
  });

  it('edição em massa: muda o status de cada lead pedido', async () => {
    const ids = [
      await criar({ nome: 'Massa Um', status: statusAberto }),
      await criar({ nome: 'Massa Dois', status: statusAberto }),
    ];

    const resposta = await chamar('PATCH', '/crm/leads/bulk', {
      ids,
      alteracoes: { status: statusFechado },
    });

    expect(resposta.status, resposta.corpo).toBe(HTTP_STATUS.OK);
    for (const id of ids) {
      expect((await ler(id)).status).toBe(statusFechado);
    }
  });

  it('listar e buscar: mesma forma, filtros por status e valor, total da consulta', async () => {
    const marca = randomUUID().slice(0, TAMANHO_SUFIXO);
    const alto = await criar({
      nome: `Busca ${marca} alto`,
      status: statusAberto,
      valor: VALOR_ALTO,
    });
    await criar({ nome: `Busca ${marca} baixo`, status: statusFechado, valor: VALOR_BAIXO });

    const lista = json(await chamar('GET', '/crm/leads')).data;
    expect(lista).toMatchObject({ itens: expect.any(Array), total: expect.any(Number) });

    const buscar = async (filtro) =>
      json(await chamar('POST', '/crm/leads/search', { busca: marca, ...filtro })).data;

    const porValor = await buscar({ valorMin: VALOR_EDITADO });
    expect(porValor.itens.map((lead) => lead.id)).toEqual([alto]);
    expect(porValor.total).toBe(1);

    const porStatus = await buscar({
      filtros: [{ chave: 'status', operador: 'igual', valor: statusAberto }],
    });
    expect(porStatus.itens.map((lead) => lead.id)).toEqual([alto]);
    for (const campo of CAMPOS_COMERCIAIS) {
      expect(porStatus.itens[0]).toHaveProperty(campo);
    }
  });

  it('exportar: status e valor saem na planilha', async () => {
    const marca = randomUUID().slice(0, TAMANHO_SUFIXO);
    await criar({ nome: `Export ${marca}`, status: statusAberto, valor: VALOR_ALTO });

    const resposta = await chamar('POST', '/crm/export', {
      formato: 'csv',
      colunas: ['nome', 'status', 'valor'],
      filtro: { busca: marca },
    });

    expect(resposta.status, resposta.corpo).toBe(HTTP_STATUS.OK);
    expect(resposta.corpo).toContain(`Export ${marca}`);
    expect(resposta.corpo).toContain(String(VALOR_ALTO));
  });

  it('importar: status e valor da planilha chegam ao lead', async () => {
    const marca = randomUUID().slice(0, TAMANHO_SUFIXO);
    const planilha = await gerarPlanilha(
      ['Nome', 'E-mail', 'Status', 'Valor'],
      [[`Import ${marca}`, `${marca}@smoke.test`, statusAberto, VALOR_ALTO]],
    );

    const validado = await validarImportacao(tenantId, donoId, planilha, {
      mapeamento: { Nome: 'nome', 'E-mail': 'email', Status: 'status', Valor: 'valor' },
      estrategiaDuplicata: 'criar',
    });
    await transicionarStatus(tenantId, validado.jobId, 'pendente', 'processando');
    await processarImportacao(tenantId, validado.jobId);

    expect(await buscarImportJob(tenantId, validado.jobId)).toMatchObject({ linhas_criadas: 1 });
    const busca = await chamar('POST', '/crm/leads/search', { busca: marca });
    const [lead] = json(busca).data.itens;
    expect(lead.status).toBe(statusAberto);
    expect(Number(lead.valor)).toBe(VALOR_ALTO);
  });

  it('mesclar: o principal fica com os dados comerciais escolhidos', async () => {
    const principal = await criar({ nome: 'Mescla Principal', status: statusAberto });
    const secundario = await criar({
      nome: 'Mescla Secundário',
      status: statusFechado,
      valor: VALOR_ALTO,
    });

    const resposta = await chamar('POST', '/crm/leads/merge', {
      principalId: principal,
      secundarioId: secundario,
      escolhas: { status: 'secundario' },
    });

    expect(resposta.status, resposta.corpo).toBe(HTTP_STATUS.OK);
    const lead = await ler(principal);
    expect(lead.status).toBe(statusFechado);
    expect(Number(lead.valor)).toBe(VALOR_ALTO);
  });

  it('anonimizar: dados comerciais não identificam e ficam para os relatórios', async () => {
    const id = await criar({ nome: 'Titular Comercial', status: statusAberto, valor: VALOR_ALTO });

    const resposta = await chamar('POST', `/crm/leads/${id}/anonimizar`, {});

    expect(resposta.status, resposta.corpo).toBe(HTTP_STATUS.OK);
    const lead = await ler(id);
    expect(lead.nome).not.toContain('Titular');
    expect(lead.status).toBe(statusAberto);
    expect(Number(lead.valor)).toBe(VALOR_ALTO);
  });

  it('funil legado: nenhum tenant recebe estágio ao ser reconciliado', async () => {
    const [{ total }] = await prisma.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_crm.funil_estagios
      WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(total).toBe(0);
  });
});
