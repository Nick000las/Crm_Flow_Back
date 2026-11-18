/**
 * @file Leva as mudanças dos provedores a quem está com o quadro aberto. Só ids: a tela relê
 * por `/cards/por-ids`, com as permissões de quem pede. Sem socket conectado nesta instância,
 * não consulta nada: o banco pode dormir, e uma instância que emite já alcança as outras pelo
 * adapter.
 */
import { randomUUID } from 'node:crypto';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';

import { DESPACHO_DE_QUADROS } from '../constants.js';
import {
  quadroWatchSchema,
  socketIdentitySchema,
  watchSchema,
} from '../schemas/realtime.schema.js';
import { autorizarQuadro, despacharEventos } from '../services/quadro-eventos.service.js';
import {
  autenticarConexao,
  autorizarSala,
  listarDestinatarios,
} from '../services/realtime.service.js';

const MILLISECONDS_PER_SECOND = 1000;
const userRoom = (tenantId, userId) => `tenant:${tenantId}:user:${userId}`;
const boardRoom = (tenantId, boardId) => `tenant:${tenantId}:board:${boardId}`;
const cardRoom = (tenantId, cardId) => `tenant:${tenantId}:card:${cardId}`;
const quadroRoom = (tenantId, boardType, quadroRef) =>
  `tenant:${tenantId}:quadro:${boardType}:${quadroRef}`;

function socketError(code, message) {
  const error = new Error(message);

  error.data = { code };

  return error;
}

/**
 * Leva as mudanças dos provedores a quem está com o quadro aberto. Só ids: a
 * tela relê por `/cards/por-ids`, com as permissões de quem pede. Sem socket
 * conectado nesta instância, não consulta nada: o banco pode dormir, e uma
 * instância que emite já alcança as outras pelo adapter.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {import('socket.io').Namespace} namespace
 */
function iniciarDespachoDeQuadros(app, namespace) {
  let rodando = false;
  const rodada = async () => {
    if (rodando || namespace.sockets.size === 0 || !app.realtime.isReady()) {
      return;
    }

    rodando = true;

    try {
      await despacharEventos(({ tenantId, boardType, quadroRef, entidadeIds }) => {
        namespace.to(quadroRoom(tenantId, boardType, quadroRef)).emit('quadro:changed', {
          id: randomUUID(),
          boardType,
          quadroRef,
          entidadeIds,
        });
      });
    } catch (error) {
      // Sem confirmação, o evento volta depois da reserva. A gravação já aconteceu.
      app.log.error({ err: error }, 'Falha ao despachar eventos de quadro.');
    } finally {
      rodando = false;
    }
  };
  const relogio = setInterval(rodada, DESPACHO_DE_QUADROS.INTERVALO_MS);

  relogio.unref();
  app.addHook('onClose', async () => clearInterval(relogio));
}

export function registrarSocketsKanban(app) {
  const namespace = app.realtime.io.of('/kanban');

  namespace.use(async (socket, next) => {
    if (!app.realtime.isReady()) {
      return next(socketError('REALTIME_UNAVAILABLE', 'Tempo real indisponível.'));
    }

    let payload;

    try {
      payload = socketIdentitySchema.parse(
        app.jwt.access.verify(socket.handshake.auth?.accessToken),
      );
    } catch {
      return next(socketError('AUTH_TOKEN_INVALID', 'Sessão inválida ou expirada.'));
    }

    try {
      socket.data.context = await autenticarConexao(payload);
      next();
    } catch (error) {
      next(
        socketError(
          error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'REALTIME_UNAVAILABLE',
          'Acesso ao Kanban indisponível.',
        ),
      );
    }
  });

  namespace.on('connection', (socket) => {
    const context = socket.data.context;

    socket.join(userRoom(context.tenantId, context.userId));

    const expiry = setTimeout(
      () => {
        socket.emit('kanban:session-expired');
        socket.disconnect(true);
      },
      Math.max(0, context.exp * MILLISECONDS_PER_SECOND - Date.now()),
    );

    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));

    socket.on('kanban:watch', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') {
        return;
      }

      const parsed = watchSchema.safeParse(input);

      if (!parsed.success) {
        return acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
      }

      try {
        const identity = await autenticarConexao(context);

        await autorizarSala(identity, parsed.data.boardId, parsed.data.cardId);

        if (!socket.connected) {
          return;
        }

        await socket.join(boardRoom(context.tenantId, parsed.data.boardId));

        if (parsed.data.cardId) {
          await socket.join(cardRoom(context.tenantId, parsed.data.cardId));
        }

        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, code: error.code ?? 'REALTIME_UNAVAILABLE' });
      }
    });

    socket.on('quadro:watch', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') {
        return;
      }

      const parsed = quadroWatchSchema.safeParse(input);

      if (!parsed.success) {
        return acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
      }

      try {
        await autorizarQuadro(await autenticarConexao(context), parsed.data);

        if (!socket.connected) {
          return;
        }

        const { boardType, quadroRef } = parsed.data;

        await socket.join(quadroRoom(context.tenantId, boardType, quadroRef));
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, code: error.code ?? 'REALTIME_UNAVAILABLE' });
      }
    });

    socket.on('quadro:unwatch', (input) => {
      const parsed = quadroWatchSchema.safeParse(input);

      if (parsed.success) {
        const { boardType, quadroRef } = parsed.data;

        socket.leave(quadroRoom(context.tenantId, boardType, quadroRef));
      }
    });

    socket.on('kanban:unwatch', (input) => {
      const parsed = watchSchema.safeParse(input);

      if (!parsed.success) {
        return;
      }

      socket.leave(boardRoom(context.tenantId, parsed.data.boardId));

      if (parsed.data.cardId) {
        socket.leave(cardRoom(context.tenantId, parsed.data.cardId));
      }
    });
  });

  iniciarDespachoDeQuadros(app, namespace);

  app.decorate('publicarKanban', async (event) => {
    try {
      if (!app.realtime.isReady()) {
        return;
      }

      const audience = await listarDestinatarios(event.tenantId, event.boardId);
      const currentIds = audience.map((user) => user.id);
      const previousIds = event.previousUserIds ?? [];
      const recipients =
        event.type === 'board.delete' ? [...new Set([...currentIds, ...previousIds])] : currentIds;
      const rooms = recipients.map((id) => userRoom(event.tenantId, id));
      const notification = {
        id: randomUUID(),
        type: event.type,
        boardId: event.boardId,
        cardId: event.cardId,
        actorId: event.actorId,
        ...(event.type === 'card.batch' && {
          cardIds: event.cardIds,
          batchAction: event.batchAction,
        }),
        conflito: event.conflito ?? false,
      };

      if (rooms.length) {
        namespace.to(rooms).emit('kanban:changed', notification);
      }

      const revoked = previousIds.filter((id) => !currentIds.includes(id));

      if (revoked.length && event.type !== 'board.delete') {
        const revokedRooms = revoked.map((id) => userRoom(event.tenantId, id));

        namespace.to(revokedRooms).emit('kanban:access-revoked', { boardId: event.boardId });
        namespace.in(revokedRooms).socketsLeave(boardRoom(event.tenantId, event.boardId));

        if (event.cardId) {
          namespace.in(revokedRooms).socketsLeave(cardRoom(event.tenantId, event.cardId));
        }
      }
    } catch (error) {
      // A transação já foi confirmada. Não transforme uma falha de entrega em falha de gravação.
      app.log.error({ err: error }, 'Falha ao publicar evento do Kanban.');
      namespace.local.emit('realtime:unavailable');

      for (const socket of namespace.sockets.values()) {
        socket.conn.close();
      }
    }
  });
}
