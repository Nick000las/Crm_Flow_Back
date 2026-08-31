import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '#api/app.js';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import {
  prepararEmails,
  carregarEmailAutorizado,
  concluirEmail,
} from './notifications.repository.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

// Opt-in: execute somente contra um banco de teste com migrations aplicadas.
const integration = process.env.RUN_KANBAN_INTEGRATION === '1' ? describe : describe.skip;

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
});
