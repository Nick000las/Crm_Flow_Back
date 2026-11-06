import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { modulosRegistrados } from '#core/registry/modules.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { invalidarAcessoModulo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { KANBAN_FEATURES, MODULO_KANBAN } from '../constants.js';
import { varrerVinculos } from '../services/varredura-vinculos.service.js';

/**
 * Aceites do M6 de ponta a ponta: Kanban e CRM reais, só pela API, como os
 * módulos se falam em produção. Tenants SMOKE apagados no fim.
 */
const integration = process.env.RUN_KANBAN_INTEGRATION === '1' ? describe : describe.skip;
const MODULO_CRM = 'crm';
const PESSOA = 'pessoa';
const FLAG_LGPD = 'crm.lgpd';
const FLAG_DUPLICIDADE = 'crm.duplicidade';
const TIMEOUT_MS = 120_000;

integration('vínculo de card com a pessoa, Kanban e CRM reais', { timeout: TIMEOUT_MS }, () => {
  const tenantId = randomUUID();
  const outroTenantId = randomUUID();
  const donoId = randomUUID();
  const editorId = randomUUID();
  const leitorId = randomUUID();
  const foraId = randomUUID();
  const donoOutroId = randomUUID();
  const admin = getAdminClient();
  let app;
  let boardId;
  let colunaId;

  const usuario = (id, tenant, nome, role = 'OPERADOR') => ({
    id,
    tenantId: tenant,
    nome,
    email: `${id}@smoke.test`,
    senhaHash: 'test',
    role,
  });

  beforeAll(async () => {
    await admin.tenant.createMany({
      data: [tenantId, outroTenantId].map((id) => ({
        id,
        nome: `SMOKE vinculos ${id}`,
        subdomain: `smoke-vinculos-${id}`,
      })),
    });
    await admin.usuario.createMany({
      data: [
        usuario(donoId, tenantId, 'Dono', 'DONO'),
        usuario(editorId, tenantId, 'Editor'),
        usuario(leitorId, tenantId, 'Leitor'),
        usuario(foraId, tenantId, 'Fora do quadro'),
        usuario(donoOutroId, outroTenantId, 'Dono de outra empresa', 'DONO'),
      ],
    });
    await admin.tenantModule.createMany({
      data: [
        { tenantId, moduleKey: MODULO_KANBAN },
        { tenantId, moduleKey: MODULO_CRM },
        { tenantId: outroTenantId, moduleKey: MODULO_KANBAN },
        { tenantId: outroTenantId, moduleKey: MODULO_CRM },
      ],
    });
    await admin.tenantModuleFeature.createMany({
      data: [
        { tenantId, moduleKey: MODULO_CRM, featureKey: FLAG_LGPD },
        { tenantId, moduleKey: MODULO_CRM, featureKey: FLAG_DUPLICIDADE },
      ],
    });
    app = await buildApp({
      config: {
        APP_NAME: 'kanban-test',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    const crm = modulosRegistrados().find((modulo) => modulo.key === MODULO_CRM);
    await crm.reconciliar(tenantId);
    await crm.reconciliar(outroTenantId);
    await invalidarFeatures(tenantId);

    const quadro = await chamar(donoId, 'DONO', 'POST', '/kanban/boards', {
      nome: 'Produção',
      boardType: 'projetos',
      participantes: [editorId, leitorId],
      permissoes: [{ id: leitorId, permissao: 'leitor' }],
      colunasIniciais: ['A fazer'],
    });
    boardId = quadro.body.data.id;
    const aberto = await chamar(donoId, 'DONO', 'GET', `/kanban/boards/${boardId}`);
    colunaId = aberto.body.data.colunas[0].id;
  });

  afterAll(async () => {
    await admin.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id IN (${tenantId}::uuid, ${outroTenantId}::uuid)`;
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, outroTenantId] } } });
    await app?.close();
    await encerrarCache();
  });

  async function chamar(userId, role, method, url, payload, tenant = tenantId) {
    const token = app.jwt.access.sign({ tenantId: tenant, userId, role });
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: resposta.statusCode, body: resposta.json() };
  }
  const dono = (...args) => chamar(donoId, 'DONO', ...args);
  const editor = (...args) => chamar(editorId, 'OPERADOR', ...args);
  const leitor = (...args) => chamar(leitorId, 'OPERADOR', ...args);
  const fora = (...args) => chamar(foraId, 'OPERADOR', ...args);

  async function criarCard(titulo = 'Produzir arte') {
    const { body } = await dono('POST', `/kanban/boards/${boardId}/cards`, { titulo, colunaId });
    return body.data.id;
  }
  async function criarPessoa(nome, tenant = tenantId, userId = donoId) {
    const { status, body } = await chamar(
      userId,
      'DONO',
      'POST',
      '/crm/leads',
      { nome, email: `${randomUUID()}@smoke.test` },
      tenant,
    );
    expect(status, JSON.stringify(body)).toBeLessThan(HTTP_STATUS.BAD_REQUEST);
    return body.data.id;
  }
  const vincular = (cardId, entidadeId, quem = dono) =>
    quem('PUT', `/kanban/cards/${cardId}/vinculo`, { entidadeTipo: PESSOA, entidadeId });
  const lerCard = async (cardId, quem = dono) =>
    (await quem('GET', `/kanban/cards/${cardId}`)).body.data;
  const aba = async (entidadeId, quem = dono) =>
    (await quem('GET', `/kanban/vinculos?entidadeTipo=${PESSOA}&entidadeId=${entidadeId}`)).body
      .data;

  async function ligarFlag() {
    await admin.tenantModuleFeature.create({
      data: {
        tenantId,
        moduleKey: MODULO_KANBAN,
        featureKey: KANBAN_FEATURES.VINCULO_ENTIDADE,
      },
    });
    await invalidarFeatures(tenantId);
  }

  it('flag desligada: nada muda nas respostas e as rotas dão 403', async () => {
    const cardId = await criarCard();
    const pessoaId = await criarPessoa('Sem flag');

    const card = await lerCard(cardId);
    for (const campo of ['vinculo', 'entidadeTipo', 'entidadeId']) {
      expect(card).not.toHaveProperty(campo);
    }
    const quadro = await dono('GET', `/kanban/boards/${boardId}`);
    expect(quadro.body.data.colunas[0].cards[0]).not.toHaveProperty('vinculo');
    expect((await vincular(cardId, pessoaId)).status).toBe(HTTP_STATUS.FORBIDDEN);

    await ligarFlag();
  });

  it('o card mostra o nome atual, sem guardar dado pessoal no Kanban', async () => {
    const cardId = await criarCard();
    const pessoaId = await criarPessoa('Jorge Tatuado');

    const vinculado = await vincular(cardId, pessoaId);
    expect(vinculado.body.data.vinculo).toMatchObject({
      tipo: PESSOA,
      id: pessoaId,
      titulo: 'Jorge Tatuado',
      rotaFicha: `/crm/leads/${pessoaId}`,
    });

    await dono('PUT', `/crm/leads/${pessoaId}`, { nome: 'Jorge Renomeado' });
    expect((await lerCard(cardId)).vinculo.titulo).toBe('Jorge Renomeado');
    const quadro = await dono('GET', `/kanban/boards/${boardId}`);
    const noQuadro = quadro.body.data.colunas[0].cards.find((item) => item.id === cardId);
    expect(noQuadro.vinculo.titulo).toBe('Jorge Renomeado');

    const [linha] = await admin.$queryRaw`
      SELECT to_jsonb(c)::text AS card,
        (SELECT jsonb_agg(a.details)::text FROM modulo_kanban_universal.activities a
         WHERE a.tenant_id = c.tenant_id AND a.card_id = c.id) AS atividades
      FROM modulo_kanban_universal.cards c WHERE c.id = ${cardId}::uuid
    `;
    expect(linha.card).not.toContain('Jorge');
    expect(linha.atividades).not.toContain('Jorge');
    expect(linha.atividades).not.toContain(pessoaId);
  });

  it('escrita segue o quadro: leitor e quem está fora não vinculam', async () => {
    const cardId = await criarCard();
    const pessoaId = await criarPessoa('Permissão');

    expect((await vincular(cardId, pessoaId, leitor)).status).toBe(HTTP_STATUS.FORBIDDEN);
    expect((await vincular(cardId, pessoaId, fora)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await vincular(cardId, pessoaId, editor)).status).toBe(HTTP_STATUS.OK);
    expect((await lerCard(cardId, leitor)).vinculo.titulo).toBe('Permissão');
  });

  it('aba Projetos: só cards dos quadros que o usuário vê, e sem arquivados', async () => {
    const cardId = await criarCard('Visível');
    const arquivadoId = await criarCard('Arquivado');
    const pessoaId = await criarPessoa('Aba');
    await vincular(cardId, pessoaId);
    await vincular(arquivadoId, pessoaId);
    await dono('PATCH', `/kanban/cards/${arquivadoId}/arquivar`, {});

    const lista = await aba(pessoaId, editor);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      cardId,
      titulo: 'Visível',
      boardId,
      boardNome: 'Produção',
      colunaNome: 'A fazer',
    });
    await expect(aba(pessoaId, fora)).resolves.toEqual([]);
  });

  it('desvincular limpa, e repetir não suja o histórico', async () => {
    const cardId = await criarCard();
    await vincular(cardId, await criarPessoa('Desvincular'));

    await dono('DELETE', `/kanban/cards/${cardId}/vinculo`);
    await dono('DELETE', `/kanban/cards/${cardId}/vinculo`);

    expect((await lerCard(cardId)).vinculo).toBeNull();
    const { body } = await dono('GET', `/kanban/cards/${cardId}/activities`);
    const acoes = body.data.map((atividade) => atividade.action);
    expect(acoes.filter((acao) => acao === 'card.unlink')).toHaveLength(1);
    expect(acoes).toContain('card.link');
  });

  it('não vincula registro de outra empresa nem o que não existe', async () => {
    const cardId = await criarCard();
    const deOutraEmpresa = await criarPessoa('Outra empresa', outroTenantId, donoOutroId);

    expect((await vincular(cardId, deOutraEmpresa)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await vincular(cardId, randomUUID())).status).toBe(HTTP_STATUS.NOT_FOUND);
    const tipoInvalido = await dono('PUT', `/kanban/cards/${cardId}/vinculo`, {
      entidadeTipo: 'inexistente',
      entidadeId: randomUUID(),
    });
    expect(tipoInvalido.status).toBe(HTTP_STATUS.NOT_FOUND);
    await expect(aba(deOutraEmpresa)).resolves.toEqual([]);
  });

  it('anonimizar: o nome some na hora; a varredura tira o vínculo e o card fica', async () => {
    const cardId = await criarCard('Card da titular');
    const outroCardId = await criarCard('Outro card da titular');
    const pessoaId = await criarPessoa('Maria Titular');
    await vincular(cardId, pessoaId);
    await vincular(outroCardId, pessoaId);

    const anonimizado = await dono('POST', `/crm/leads/${pessoaId}/anonimizar`, {});
    expect(anonimizado.status).toBe(HTTP_STATUS.OK);

    const restrito = await lerCard(cardId);
    expect(restrito.vinculo).toEqual({ tipo: PESSOA, restrito: true });
    await expect(aba(pessoaId)).resolves.toEqual([]);

    const relatorio = await varrerVinculos();
    expect(relatorio.falhas).toEqual([]);

    for (const id of [cardId, outroCardId]) {
      const card = await lerCard(id);
      expect(card.vinculo).toBeNull();
      expect(card.titulo).toContain('titular');
    }
    const [{ total }] = await admin.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_kanban_universal.cards
      WHERE tenant_id = ${tenantId}::uuid AND entidade_id = ${pessoaId}::uuid
    `;
    expect(total).toBe(0);
  });

  it('mesclar: vale na leitura, a varredura troca o id, inclusive em cadeia', async () => {
    const cardId = await criarCard('Card do mesclado');
    const primeiro = await criarPessoa('Primeiro');
    const segundo = await criarPessoa('Segundo');
    const terceiro = await criarPessoa('Terceiro');
    await vincular(cardId, primeiro);
    const mesclar = (principalId, secundarioId) =>
      dono('POST', '/crm/leads/merge', { principalId, secundarioId });

    expect((await mesclar(segundo, primeiro)).status).toBe(HTTP_STATUS.OK);
    expect((await lerCard(cardId)).vinculo).toMatchObject({
      id: segundo,
      titulo: 'Segundo',
      rotaFicha: `/crm/leads/${segundo}`,
    });

    expect((await mesclar(terceiro, segundo)).status).toBe(HTTP_STATUS.OK);
    expect((await lerCard(cardId)).vinculo).toMatchObject({ id: terceiro, titulo: 'Terceiro' });
    await expect(aba(terceiro)).resolves.toEqual([]);

    expect((await varrerVinculos()).falhas).toEqual([]);
    const [{ entidade_id: gravado }] = await admin.$queryRaw`
      SELECT entidade_id::text FROM modulo_kanban_universal.cards WHERE id = ${cardId}::uuid
    `;
    expect(gravado).toBe(terceiro);
    expect((await aba(terceiro)).map((item) => item.cardId)).toEqual([cardId]);
  });

  it('CRM desligado no tenant: vínculo restrito, o card abre e nada se vincula', async () => {
    const cardId = await criarCard();
    const pessoaId = await criarPessoa('Sem CRM');
    await vincular(cardId, pessoaId);

    const contrato = { tenantId, moduleKey: MODULO_CRM };
    await admin.tenantModule.updateMany({ where: contrato, data: { disabledAt: new Date() } });
    await invalidarAcessoModulo(tenantId);

    expect((await lerCard(cardId)).vinculo).toEqual({ tipo: PESSOA, restrito: true });
    expect((await vincular(await criarCard(), pessoaId)).status).toBe(HTTP_STATUS.NOT_FOUND);

    await admin.tenantModule.updateMany({ where: contrato, data: { disabledAt: null } });
    await invalidarAcessoModulo(tenantId);
  });

  it('nenhuma tabela do Kanban ganhou coluna de texto livre para o registro', async () => {
    const colunas = await admin.$queryRaw`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'modulo_kanban_universal' AND column_name LIKE 'entidade%'
      ORDER BY column_name
    `;
    expect(colunas).toEqual([
      { column_name: 'entidade_id', data_type: 'uuid' },
      { column_name: 'entidade_tipo', data_type: 'text' },
    ]);
  });
});
