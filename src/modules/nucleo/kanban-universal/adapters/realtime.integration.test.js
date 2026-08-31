import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { buildApp } from '#api/app.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

const EVENT_TIMEOUT_MS = 5000;
const QUIET_WINDOW_MS = 100;
const TEST_TIMEOUT_MS = 15000;
const TOKEN_EXPIRY_SECONDS = 2;
const enabled = process.env.RUN_KANBAN_INTEGRATION === '1' && process.env.KANBAN_TEST_REDIS_URL;
const integration = enabled ? describe : describe.skip;

function waitFor(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`Evento ${name} não recebido.`));
    }, EVENT_TIMEOUT_MS);
    function handler(event) {
      if (!predicate(event)) {
        return;
      }
      clearTimeout(timer);
      socket.off(name, handler);
      resolve(event);
    }
    socket.on(name, handler);
  });
}

integration('Socket.IO com PostgreSQL e Redis entre duas instâncias', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const foreignId = randomUUID();
  const admin = getAdminClient();
  const sockets = [];
  let first;
  let second;
  let firstUrl;
  let secondUrl;

  beforeAll(async () => {
    await admin.tenant.createMany({
      data: [
        { id: tenantId, nome: 'Socket A', subdomain: `socket-${tenantId}` },
        { id: otherTenantId, nome: 'Socket B', subdomain: `socket-${otherTenantId}` },
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
          nome: 'Equipe',
          email: `${memberId}@teste.local`,
          senhaHash: 'test',
        },
        {
          id: outsiderId,
          tenantId,
          nome: 'Fora da equipe',
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
      ],
    });
    await admin.tenantModule.createMany({
      data: [
        { tenantId, moduleKey: 'kanban_universal' },
        { tenantId: otherTenantId, moduleKey: 'kanban_universal' },
      ],
    });
    const config = {
      NODE_ENV: 'test',
      APP_NAME: 'socket-test',
      CORS_ORIGIN: '*',
      JWT_SECRET: 'socket-test-access-only-32-characters',
      JWT_REFRESH_SECRET: 'socket-test-refresh-only-32-characters',
      REDIS_URL: process.env.KANBAN_TEST_REDIS_URL,
      SOCKET_REDIS_PREFIX: `kanban-test:${randomUUID()}`,
    };
    first = await buildApp({ config });
    second = await buildApp({ config });
    firstUrl = await first.listen({ port: 0, host: '127.0.0.1' });
    secondUrl = await second.listen({ port: 0, host: '127.0.0.1' });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await Promise.all([first?.close(), second?.close()]);
  });

  function token(userId, company = tenantId, role = 'OPERADOR', options) {
    return first.jwt.access.sign({ userId, tenantId: company, role }, options);
  }
  function connect(url, accessToken) {
    const socket = io(`${url}/kanban`, {
      transports: ['websocket'],
      auth: { accessToken },
      autoConnect: false,
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }
  async function connected(socket) {
    const ready = waitFor(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
  }
  async function write(method, url, payload) {
    const response = await first.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token(ownerId, tenantId, 'DONO')}` },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    return response.json().data;
  }
  async function watch(socket, boardId) {
    return socket.timeout(EVENT_TIMEOUT_MS).emitWithAck('kanban:watch', { boardId });
  }

  it('rejeita conexões sem sessão e sessões expiradas', async () => {
    for (const accessToken of [undefined, token(ownerId, tenantId, 'DONO', { expiresIn: -1 })]) {
      const socket = connect(firstUrl, accessToken);
      const error = waitFor(socket, 'connect_error');
      socket.connect();
      expect((await error).data.code).toBe('AUTH_TOKEN_INVALID');
    }
  });

  it(
    'entrega alterações confirmadas, comentários e revoga o acesso entre instâncias',
    async () => {
      const member = await connected(connect(secondUrl, token(memberId)));
      const outsider = await connected(connect(secondUrl, token(outsiderId)));
      const foreign = await connected(connect(secondUrl, token(foreignId, otherTenantId, 'DONO')));
      const unauthorizedEvents = [];
      outsider.on('kanban:changed', (event) => unauthorizedEvents.push(event));
      foreign.on('kanban:changed', (event) => unauthorizedEvents.push(event));

      const createdEvent = waitFor(
        member,
        'kanban:changed',
        (event) => event.type === 'board.create',
      );
      const board = await write('POST', '/kanban/boards', {
        nome: 'Equipe ao vivo',
        boardType: 'projetos',
        participantes: [memberId],
      });
      expect((await createdEvent).boardId).toBe(board.id);
      expect((await watch(member, board.id)).ok).toBe(true);
      expect((await watch(outsider, board.id)).ok).toBe(false);
      expect((await watch(foreign, board.id)).ok).toBe(false);

      const firstColumn = await write('POST', `/kanban/boards/${board.id}/colunas`, {
        nome: 'A fazer',
      });
      const secondColumn = await write('POST', `/kanban/boards/${board.id}/colunas`, {
        nome: 'Feito',
      });
      const cardEvent = waitFor(member, 'kanban:changed', (event) => event.type === 'card.create');
      const card = await write('POST', `/kanban/boards/${board.id}/cards`, {
        colunaId: firstColumn.id,
        titulo: 'Card ao vivo',
      });
      const notification = await cardEvent;
      expect(notification.cardId).toBe(card.id);
      expect(notification).not.toHaveProperty('titulo');
      const cardSubscription = await member
        .timeout(EVENT_TIMEOUT_MS)
        .emitWithAck('kanban:watch', { boardId: board.id, cardId: card.id });
      expect(cardSubscription.ok).toBe(true);
      const invalidCard = await member
        .timeout(EVENT_TIMEOUT_MS)
        .emitWithAck('kanban:watch', { boardId: board.id, cardId: randomUUID() });
      expect(invalidCard).toMatchObject({ ok: false, code: 'RESOURCE_NOT_FOUND' });
      // Ao receber o evento na segunda instância, a alteração já é consultável no banco.
      const persisted = await second.inject({
        method: 'GET',
        url: `/kanban/cards/${card.id}`,
        headers: { authorization: `Bearer ${token(memberId)}` },
      });
      expect(persisted.json().data.titulo).toBe('Card ao vivo');

      const detailsEvent = waitFor(
        member,
        'kanban:changed',
        (event) => event.type === 'card.update',
      );
      await write('PATCH', `/kanban/cards/${card.id}`, {
        dadosExtras: {
          prioridade: 'urgente',
          prazo: '2028-02-29',
          checklist: [{ id: randomUUID(), titulo: 'Revisar', concluido: false }],
        },
        expectedUpdatedAt: card.updatedAt,
      });
      expect((await detailsEvent).cardId).toBe(card.id);
      const updatedDetails = await second.inject({
        method: 'GET',
        url: `/kanban/cards/${card.id}`,
        headers: { authorization: `Bearer ${token(memberId)}` },
      });
      expect(updatedDetails.json().data.dadosExtras).toMatchObject({
        prioridade: 'urgente',
        prazo: '2028-02-29',
      });
      const commentEvent = waitFor(
        member,
        'kanban:changed',
        (event) => event.type === 'comment.create',
      );
      const comment = await write('POST', `/kanban/cards/${card.id}/comments`, {
        conteudo: 'Comentário ao vivo',
      });
      expect((await commentEvent).cardId).toBe(card.id);
      const removedComment = waitFor(
        member,
        'kanban:changed',
        (event) => event.type === 'comment.delete',
      );
      await write('DELETE', `/kanban/comments/${comment.id}`);
      expect((await removedComment).cardId).toBe(card.id);

      const movedEvent = waitFor(member, 'kanban:changed', (event) => event.type === 'card.move');
      await write('PATCH', `/kanban/cards/${card.id}/mover`, {
        novaColunaId: secondColumn.id,
        novaOrdem: 0,
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      });
      expect(await movedEvent).toMatchObject({
        boardId: board.id,
        cardId: card.id,
        conflito: true,
      });

      const revoked = waitFor(member, 'kanban:access-revoked');
      await write('PUT', `/kanban/boards/${board.id}/membros`, { participantes: [ownerId] });
      expect((await revoked).boardId).toBe(board.id);
      const unauthorized = await second.inject({
        method: 'GET',
        url: `/kanban/boards/${board.id}`,
        headers: { authorization: `Bearer ${token(memberId)}` },
      });
      expect(unauthorized.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
      const lateEvents = [];
      member.on('kanban:changed', (event) => lateEvents.push(event));
      await write('PATCH', `/kanban/cards/${card.id}`, { titulo: 'Após revogação' });
      await delay(QUIET_WINDOW_MS);
      expect(lateEvents).toEqual([]);
      expect(unauthorizedEvents).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it('encerra a conexão quando o access token expira', async () => {
    const socket = connect(
      firstUrl,
      token(ownerId, tenantId, 'DONO', { expiresIn: TOKEN_EXPIRY_SECONDS }),
    );
    const expired = waitFor(socket, 'kanban:session-expired');
    const disconnected = waitFor(socket, 'disconnect');
    await connected(socket);
    await expired;
    expect(await disconnected).toBe('io server disconnect');
  });
});
