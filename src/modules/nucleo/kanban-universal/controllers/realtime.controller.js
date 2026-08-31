import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { socketIdentitySchema, watchSchema } from '../schemas/realtime.schema.js';
import {
  autenticarConexao,
  autorizarSala,
  listarDestinatarios,
} from '../services/realtime.service.js';

const MILLISECONDS_PER_SECOND = 1000;
const userRoom = (tenantId, userId) => `tenant:${tenantId}:user:${userId}`;
const boardRoom = (tenantId, boardId) => `tenant:${tenantId}:board:${boardId}`;
const cardRoom = (tenantId, cardId) => `tenant:${tenantId}:card:${cardId}`;

function socketError(code, message) {
  const error = new Error(message);
  error.data = { code };
  return error;
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
