import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { buildApp } from '#api/app.js';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { invalidarAcessoModulo } from '#core/tenant/module-access.js';
import {
  listarEmpresasParaEmail,
  prepararEmails,
  carregarEmailAutorizado,
  concluirEmail,
} from './notifications.repository.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

// Opt-in: execute somente contra um banco de teste com migrations aplicadas.
const integration = process.env.RUN_KANBAN_INTEGRATION === '1' ? describe : describe.skip;
const ESPERA_POR_BLOQUEIO_MS = 1500;
const TAMANHO_DATA = 10;
const CARDS_CONCORRENTES = 3;
// 25h de distância: nunca estão na mesma data, em nenhuma hora do dia.
const FUSO_ADIANTADO = 'Pacific/Kiritimati';
const FUSO_ATRASADO = 'Pacific/Pago_Pago';

const hojeNoFuso = (fuso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());

integration('quadros e equipes no PostgreSQL', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const foreignId = randomUUID();
  const inactiveId = randomUUID();
  const admin = getAdminClient();
  let app;

  beforeAll(async () => {
    await admin.tenant.createMany({
      data: [
        { id: tenantId, nome: 'Kanban integration', subdomain: `kanban-${tenantId}` },
        { id: otherTenantId, nome: 'Outra empresa', subdomain: `kanban-${otherTenantId}` },
      ],
    });
    await admin.usuario.createMany({
      data: [
        {
          id: ownerId,
          tenantId,
          nome: 'Dono',
          email: `${ownerId}@teste.local`,
          senhaHash: 'test',
          role: 'DONO',
        },
        {
          id: memberId,
          tenantId,
          nome: 'Participante',
          email: `${memberId}@teste.local`,
          senhaHash: 'test',
        },
        {
          id: outsiderId,
          tenantId,
          nome: 'Não participante',
          email: `${outsiderId}@teste.local`,
          senhaHash: 'test',
        },
        {
          id: foreignId,
          tenantId: otherTenantId,
          nome: 'Outra empresa',
          email: `${foreignId}@teste.local`,
          senhaHash: 'test',
          role: 'DONO',
        },
        {
          id: inactiveId,
          tenantId,
          nome: 'Inativo',
          email: `${inactiveId}@teste.local`,
          senhaHash: 'test',
          ativo: false,
        },
      ],
    });
    await admin.tenantModule.createMany({
      data: [
        { tenantId, moduleKey: 'kanban_universal' },
        { tenantId: otherTenantId, moduleKey: 'kanban_universal' },
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
  });

  afterAll(async () => {
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await app?.close();
  });

  async function request(userId, role, method, url, payload, companyId = tenantId) {
    const token = app.jwt.access.sign({ tenantId: companyId, userId, role });
    const response = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.statusCode, body: response.json() };
  }
  const owner = (method, url, payload) => request(ownerId, 'DONO', method, url, payload);
  const member = (method, url, payload) => request(memberId, 'OPERADOR', method, url, payload);
  const outsider = (method, url, payload) => request(outsiderId, 'OPERADOR', method, url, payload);

  it('persiste equipe, restringe recursos indiretos e revoga atribuições atomicamente', async () => {
    const created = await owner('POST', '/kanban/boards', {
      nome: 'Equipe',
      boardType: 'projetos',
      participantes: [memberId],
    });
    expect(created.status).toBe(HTTP_STATUS.OK);
    const boardId = created.body.data.id;
    expect(created.body.data.participantes.map((user) => user.id).sort()).toEqual(
      [ownerId, memberId].sort(),
    );

    const visible = await member('GET', '/kanban/boards');
    expect(visible.body.data.map((board) => board.id)).toContain(boardId);
    expect((await outsider('GET', '/kanban/boards')).body.data).toEqual([]);
    expect((await outsider('GET', `/kanban/boards/${boardId}`)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(
      (await member('PUT', `/kanban/boards/${boardId}/membros`, { participantes: [memberId] }))
        .status,
    ).toBe(HTTP_STATUS.FORBIDDEN);

    const column = await owner('POST', `/kanban/boards/${boardId}/colunas`, { nome: 'A fazer' });
    const columnId = column.body.data.id;
    const card = await member('POST', `/kanban/boards/${boardId}/cards`, {
      titulo: 'Tarefa',
      colunaId: columnId,
      responsavelId: memberId,
    });
    expect(card.status).toBe(HTTP_STATUS.OK);
    const cardId = card.body.data.id;
    const details = {
      descricao: 'Escopo da entrega',
      prioridade: 'alta',
      prazo: '2028-02-29',
      prazoConcluido: false,
      etiquetas: [{ id: randomUUID(), nome: 'Cliente', cor: 'azul' }],
      checklist: [{ id: randomUUID(), titulo: 'Revisar', concluido: true }],
      leadId: 'metadado-especifico',
    };
    const updated = await member('PATCH', `/kanban/cards/${cardId}`, {
      dadosExtras: details,
      expectedUpdatedAt: card.body.data.updatedAt,
    });
    expect(updated.status).toBe(HTTP_STATUS.OK);
    expect(updated.body.data.dadosExtras).toEqual(details);
    const partial = await member('PATCH', `/kanban/cards/${cardId}`, {
      dadosExtras: { prioridade: 'urgente' },
      expectedUpdatedAt: updated.body.data.updatedAt,
    });
    expect(partial.body.data.dadosExtras).toEqual({ ...details, prioridade: 'urgente' });
    const stale = await member('PATCH', `/kanban/cards/${cardId}`, {
      titulo: 'Sobrescrita antiga',
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(stale.status).toBe(HTTP_STATUS.CONFLICT);
    expect((await member('GET', `/kanban/cards/${cardId}`)).body.data.titulo).toBe('Tarefa');
    const invalidDetails = await member('PATCH', `/kanban/cards/${cardId}`, {
      dadosExtras: { prazo: '2026-02-30' },
    });
    expect(invalidDetails.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const comment = await member('POST', `/kanban/cards/${cardId}/comments`, {
      conteudo: 'Mensagem',
    });
    const commentId = comment.body.data.id;

    const deniedResources = [
      ['GET', `/kanban/cards/${cardId}`],
      ['PATCH', `/kanban/cards/${cardId}`, { titulo: 'Indevido' }],
      ['PATCH', `/kanban/cards/${cardId}/mover`, { novaColunaId: columnId, novaOrdem: 0 }],
      ['DELETE', `/kanban/cards/${cardId}`],
      ['GET', `/kanban/cards/${cardId}/comments`],
      ['POST', `/kanban/cards/${cardId}/comments`, { conteudo: 'Indevido' }],
      ['DELETE', `/kanban/comments/${commentId}`],
      ['GET', `/kanban/boards/${boardId}/membros`],
    ];
    for (const [method, url, payload] of deniedResources) {
      expect((await outsider(method, url, payload)).status).toBe(HTTP_STATUS.NOT_FOUND);
    }
    expect(
      (await member('PATCH', `/kanban/cards/${cardId}`, { responsavelId: outsiderId })).status,
    ).toBe(HTTP_STATUS.CONFLICT);

    // Uma equipe inválida reverte também a edição do nome do quadro.
    for (const invalidUser of [foreignId, inactiveId]) {
      const invalid = await owner('PATCH', `/kanban/boards/${boardId}`, {
        nome: 'Não deve persistir',
        participantes: [invalidUser],
      });
      expect(invalid.status).toBe(HTTP_STATUS.CONFLICT);
      expect((await owner('GET', `/kanban/boards/${boardId}`)).body.data.nome).toBe('Equipe');
    }

    await owner('PUT', `/kanban/boards/${boardId}/membros`, { participantes: [ownerId] });
    expect((await owner('GET', `/kanban/cards/${cardId}`)).body.data.responsavelId).toBeNull();
    expect((await member('GET', `/kanban/boards/${boardId}`)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await member('GET', '/kanban/boards')).body.data).toEqual([]);
    expect((await owner('GET', `/kanban/boards/${boardId}`)).status).toBe(HTTP_STATUS.OK);

    // As constraints também rejeitam referências de outra empresa sem passar pela API.
    await expect(
      getTenantClient(
        tenantId,
        (tx) => tx.$executeRaw`
      INSERT INTO modulo_kanban_universal.board_members (tenant_id, board_id, usuario_id)
      VALUES (${tenantId}::uuid, ${boardId}::uuid, ${foreignId}::uuid)
    `,
      ),
    ).rejects.toThrow();
    const foreignBoard = await request(
      foreignId,
      'DONO',
      'POST',
      '/kanban/boards',
      { nome: 'Quadro de outra empresa', boardType: 'projetos' },
      otherTenantId,
    );
    await expect(
      getTenantClient(
        tenantId,
        (tx) => tx.$executeRaw`
      INSERT INTO modulo_kanban_universal.board_members (tenant_id, board_id, usuario_id)
      VALUES (${tenantId}::uuid, ${foreignBoard.body.data.id}::uuid, ${ownerId}::uuid)
    `,
      ),
    ).rejects.toThrow();
    const otherRows = await getTenantClient(
      otherTenantId,
      (tx) => tx.$queryRaw`
      SELECT * FROM modulo_kanban_universal.board_members WHERE board_id = ${boardId}::uuid
    `,
    );
    expect(otherRows).toEqual([]);
    expect(
      (
        await request(
          foreignId,
          'DONO',
          'GET',
          `/kanban/boards/${boardId}`,
          undefined,
          otherTenantId,
        )
      ).status,
    ).toBe(HTTP_STATUS.NOT_FOUND);
  });
  it('arquiva, restaura, audita, restringe leitores e enfileira avisos sem SMTP', async () => {
    const created = await owner('POST', '/kanban/boards', {
      nome: 'Profissional',
      boardType: 'projetos',
      participantes: [memberId],
      colunasIniciais: ['A fazer', 'Concluído'],
      permissoes: [{ id: memberId, permissao: 'leitor' }],
    });
    expect(created.status).toBe(HTTP_STATUS.OK);
    const boardId = created.body.data.id;
    const board = (await owner('GET', `/kanban/boards/${boardId}`)).body.data;
    expect((await member('GET', `/kanban/boards/${boardId}`)).body.data.canEdit).toBe(false);
    expect(
      (
        await member('POST', `/kanban/boards/${boardId}/cards`, {
          titulo: 'Negado',
          colunaId: board.colunas[0].id,
        })
      ).status,
    ).toBe(HTTP_STATUS.FORBIDDEN);
    const createdCard = await owner('POST', `/kanban/boards/${boardId}/cards`, {
      titulo: 'Entrega',
      dadosExtras: {
        prazo: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
          new Date(),
        ),
      },
      colunaId: board.colunas[0].id,
      responsavelId: memberId,
    });
    expect(createdCard.status).toBe(HTTP_STATUS.OK);
    const cardId = createdCard.body.data.id;
    const assignment = await getTenantClient(
      tenantId,
      (tx) =>
        tx.$queryRaw`SELECT kind FROM modulo_kanban_universal.email_outbox WHERE tenant_id=${tenantId}::uuid AND card_id=${cardId}::uuid`,
    );
    expect(assignment).toEqual([{ kind: 'assignment' }]);
    const comment = await owner('POST', `/kanban/cards/${cardId}/comments`, {
      conteudo: 'Olá João Silva',
      mencionados: [memberId, foreignId],
    });
    expect(comment.status).toBe(HTTP_STATUS.OK);
    const mentions = await getTenantClient(
      tenantId,
      (tx) =>
        tx.$queryRaw`SELECT usuario_id FROM modulo_kanban_universal.email_outbox WHERE tenant_id=${tenantId}::uuid AND card_id=${cardId}::uuid AND kind='mention'`,
    );
    expect(mentions).toEqual([{ usuario_id: memberId }]);
    expect((await member('PATCH', `/kanban/cards/${cardId}/arquivar`, {})).status).toBe(
      HTTP_STATUS.FORBIDDEN,
    );
    expect((await owner('PATCH', `/kanban/cards/${cardId}/arquivar`, {})).status).toBe(
      HTTP_STATUS.OK,
    );
    expect((await owner('GET', `/kanban/boards/${boardId}`)).body.data.colunas[0].cards).toEqual(
      [],
    );
    expect(
      (await member('GET', `/kanban/boards/${boardId}/arquivados`)).body.data.map(
        (card) => card.id,
      ),
    ).toEqual([cardId]);
    expect((await owner('PATCH', `/kanban/cards/${cardId}/restaurar`, {})).status).toBe(
      HTTP_STATUS.OK,
    );
    const activities = (await member('GET', `/kanban/cards/${cardId}/activities`)).body.data;
    expect(activities.map((a) => a.action)).toEqual(
      expect.arrayContaining(['card.create', 'comment.create', 'card.archive', 'card.restore']),
    );
    expect(activities.every((a) => a.autor === 'Dono')).toBe(true);
    expect((await outsider('GET', `/kanban/cards/${cardId}/activities`)).status).toBe(
      HTTP_STATUS.NOT_FOUND,
    );
    const pending = await prepararEmails(tenantId, 'America/Sao_Paulo', randomUUID());
    expect(pending.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['assignment', 'mention', 'due']),
    );
    expect(await prepararEmails(tenantId, 'America/Sao_Paulo', randomUUID())).toEqual([]);
    const notification = pending.find((item) => item.kind === 'due');
    expect(await carregarEmailAutorizado(tenantId, notification)).toMatchObject({
      titulo: 'Entrega',
    });
    expect(
      (await member('PUT', '/kanban/email-preferences', { enabled: false })).body.data,
    ).toEqual({ enabled: false });
    expect((await member('GET', '/kanban/email-preferences')).body.data).toEqual({
      enabled: false,
    });
    expect(await carregarEmailAutorizado(tenantId, notification)).toBeUndefined();
    await concluirEmail(tenantId, notification, 'cancelled');
    const changed = await owner('PATCH', `/kanban/colunas/${board.colunas[0].id}`, {
      nome: 'A fazer',
      wipLimit: 1,
    });
    expect(changed.body.data.wipLimit).toBe(1);
    await owner('DELETE', `/kanban/boards/${boardId}`);
  });

  it('módulo desligado barra o Kanban, inclusive para o dono', async () => {
    const ligado = { tenantId, moduleKey: 'kanban_universal' };
    await admin.tenantModule.updateMany({ where: ligado, data: { disabledAt: new Date() } });
    await invalidarAcessoModulo(tenantId);
    expect((await owner('GET', '/kanban/boards')).status).toBe(HTTP_STATUS.FORBIDDEN);

    await admin.tenantModule.updateMany({ where: ligado, data: { disabledAt: null } });
    await invalidarAcessoModulo(tenantId);
    expect((await owner('GET', '/kanban/boards')).status).toBe(HTTP_STATUS.OK);
  });

  it('quadros de entidade: desligado nada muda; ligado, nativo ganha o modo e quadro sem provedor é 404', async () => {
    const criado = await owner('POST', '/kanban/boards', { nome: 'Nativo', boardType: 'projetos' });
    const boardId = criado.body.data.id;
    const doQuadro = (lista) => lista.find((board) => board.id === boardId);

    const desligado = await owner('GET', '/kanban/boards');
    expect(doQuadro(desligado.body.data)).not.toHaveProperty('modo');
    const semFlag = await owner('GET', '/kanban/quadros/projetos/qualquer/colunas');
    expect(semFlag.status).toBe(HTTP_STATUS.FORBIDDEN);

    await admin.tenantModuleFeature.create({
      data: {
        tenantId,
        moduleKey: 'kanban_universal',
        featureKey: 'kanban_universal.quadros_entidade',
      },
    });
    await invalidarFeatures(tenantId);

    const ligado = await owner('GET', '/kanban/boards');
    expect(doQuadro(ligado.body.data)).toMatchObject({ modo: 'nativo' });
    const semProvedor = await owner('GET', '/kanban/quadros/projetos/qualquer/colunas');
    expect(semProvedor.status).toBe(HTTP_STATUS.NOT_FOUND);

    await admin.tenantModuleFeature.deleteMany({ where: { tenantId } });
    await invalidarFeatures(tenantId);
    await owner('DELETE', `/kanban/boards/${boardId}`);
  });

  /** Mantém o advisory lock até `soltar()`, como uma escrita em andamento faria. */
  async function segurarLock(chave) {
    let soltar;
    const liberado = new Promise((resolve) => {
      soltar = resolve;
    });
    let avisarAdquirido;
    const adquirido = new Promise((resolve) => {
      avisarAdquirido = resolve;
    });
    const transacao = getTenantClient(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
      avisarAdquirido();
      await liberado;
    });
    await adquirido;
    return {
      soltar: async () => {
        soltar();
        await transacao;
      },
    };
  }

  async function quadroComCards(nome, titulos) {
    const criado = await owner('POST', '/kanban/boards', {
      nome,
      boardType: 'projetos',
      colunasIniciais: ['A fazer', 'Feito'],
    });
    const boardId = criado.body.data.id;
    const board = (await owner('GET', `/kanban/boards/${boardId}`)).body.data;
    const [origem, destino] = board.colunas;
    const cards = [];
    for (const titulo of titulos) {
      const card = await owner('POST', `/kanban/boards/${boardId}/cards`, {
        titulo,
        colunaId: origem.id,
      });
      cards.push(card.body.data);
    }
    return { boardId, origem, destino, cards };
  }

  const esperar = (ms) =>
    new Promise((resolve) => {
      setTimeout(() => resolve('pendente'), ms);
    });

  it('escritas em quadros diferentes não entram em fila; no mesmo quadro, sim', async () => {
    const quadroA = await quadroComCards('Quadro A', ['A1']);
    const quadroB = await quadroComCards('Quadro B', ['B1']);
    const editar = (card, titulo) => owner('PATCH', `/kanban/cards/${card.id}`, { titulo });

    // Nada disputa mais o tenant inteiro.
    const lockDoTenant = await segurarLock(tenantId);
    const semFila = await Promise.race([
      editar(quadroA.cards[0], 'A1 editado'),
      esperar(ESPERA_POR_BLOQUEIO_MS),
    ]);
    await lockDoTenant.soltar();
    expect(semFila).toMatchObject({ status: HTTP_STATUS.OK });

    // Quadro B ocupado: A segue, e B espera a vez dele.
    const lockDoQuadro = await segurarLock(quadroB.boardId);
    expect(await editar(quadroA.cards[0], 'A1 de novo')).toMatchObject({ status: HTTP_STATUS.OK });
    const escritaEmB = editar(quadroB.cards[0], 'B1 editado');
    expect(await Promise.race([escritaEmB, esperar(ESPERA_POR_BLOQUEIO_MS)])).toBe('pendente');
    await lockDoQuadro.soltar();
    expect(await escritaEmB).toMatchObject({ status: HTTP_STATUS.OK });

    await owner('DELETE', `/kanban/boards/${quadroA.boardId}`);
    await owner('DELETE', `/kanban/boards/${quadroB.boardId}`);
  });

  it('movimentos simultâneos no mesmo quadro mantêm a ordem íntegra, inclusive para quem lê', async () => {
    const titulos = Array.from({ length: CARDS_CONCORRENTES }, (_, indice) => `Card ${indice}`);
    const { boardId, destino, cards } = await quadroComCards('Quadro concorrente', titulos);

    const [leitura] = await Promise.all([
      owner('GET', `/kanban/boards/${boardId}`),
      ...cards.map((card) =>
        owner('PATCH', `/kanban/cards/${card.id}/mover`, {
          novaColunaId: destino.id,
          novaOrdem: 0,
        }),
      ),
    ]);
    // Leitura sem lock nunca vê card duplicado nem perdido.
    const vistos = leitura.body.data.colunas.flatMap((coluna) => coluna.cards.map((c) => c.id));
    expect(vistos.sort()).toEqual(cards.map((card) => card.id).sort());

    const final = (await owner('GET', `/kanban/boards/${boardId}`)).body.data;
    const coluna = final.colunas.find((item) => item.id === destino.id);
    expect(coluna.cards.map((card) => card.ordem)).toEqual(titulos.map((_, indice) => indice));
    await owner('DELETE', `/kanban/boards/${boardId}`);
  });

  it('o lembrete de prazo usa a data local do fuso do tenant', async () => {
    await admin.tenant.update({ where: { id: tenantId }, data: { fusoHorario: FUSO_ADIANTADO } });
    const empresas = [];
    for (let lote = await listarEmpresasParaEmail(null); lote.length;) {
      empresas.push(...lote);
      lote = await listarEmpresasParaEmail(lote.at(-1).id);
    }
    expect(empresas.find((item) => item.id === tenantId).fuso_horario).toBe(FUSO_ADIANTADO);

    const { boardId, cards, origem } = await quadroComCards('Quadro de prazos', []);
    expect(cards).toEqual([]);
    const prazo = hojeNoFuso(FUSO_ADIANTADO).slice(0, TAMANHO_DATA);
    const criado = await owner('POST', `/kanban/boards/${boardId}/cards`, {
      titulo: 'Entrega no outro lado do mundo',
      colunaId: origem.id,
      responsavelId: ownerId,
      dadosExtras: { prazo },
    });
    const cardId = criado.body.data.id;
    const lembretes = (itens) =>
      itens.filter((item) => item.kind === 'due' && item.card_id === cardId);

    expect(lembretes(await prepararEmails(tenantId, FUSO_ATRASADO, randomUUID()))).toEqual([]);
    expect(lembretes(await prepararEmails(tenantId, FUSO_ADIANTADO, randomUUID()))).toHaveLength(1);
    await owner('DELETE', `/kanban/boards/${boardId}`);
  });
});
