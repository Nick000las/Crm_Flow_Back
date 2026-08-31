import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { setTimeout, clearTimeout } from 'node:timers';
import { parseCorsOrigins } from '#core/config/env.js';

const REDIS_CONNECT_TIMEOUT_MS = 5000;
const REDIS_RETRY_STEP_MS = 200;
const REDIS_RETRY_MAX_MS = 3000;
const MAX_SOCKET_MESSAGE_BYTES = 16384;

/** Transporte compartilhado. A autorização e os eventos pertencem aos módulos. */
export async function registerRealtime(app) {
  const origins = parseCorsOrigins(app.config.CORS_ORIGIN);
  const io = new Server(app.server, {
    transports: ['websocket'],
    serveClient: false,
    maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES,
    cors: { origin: origins, credentials: true },
    allowRequest: (request, done) => {
      const origin = request.headers.origin;
      done(null, !origin || origins === '*' || origins.includes(origin));
    },
  });
  // Somente namespaces autenticados de módulos aceitam conexões.
  io.use((_socket, next) => next(new Error('Namespace indisponível.')));
  const namespaces = new Set([io.sockets]);
  io.on('new_namespace', (namespace) => namespaces.add(namespace));
  let available = true;
  let stopping = false;
  let clients = [];

  function updateAvailability() {
    if (stopping) {
      return;
    }
    const next = clients.every((client) => client.status === 'ready');
    if (available === next) {
      return;
    }
    available = next;
    // Cada instância avisa seus clientes locais, mesmo com o broker indisponível.
    for (const namespace of namespaces) {
      namespace.local.emit(next ? 'realtime:ready' : 'realtime:unavailable');
    }
  }

  try {
    if (app.config.NODE_ENV !== 'test' || app.config.REDIS_URL) {
      if (!app.config.REDIS_URL) {
        throw new Error('REDIS_URL é obrigatório para o tempo real.');
      }
      const publisher = new Redis(app.config.REDIS_URL, {
        lazyConnect: true,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        maxRetriesPerRequest: null,
        retryStrategy: (attempt) => Math.min(attempt * REDIS_RETRY_STEP_MS, REDIS_RETRY_MAX_MS),
      });
      clients = [publisher, publisher.duplicate()];
      available = false;
      for (const client of clients) {
        client.on('error', () => app.log.error('Conexão Redis do tempo real indisponível.'));
        client.on('close', updateAvailability);
        client.on('ready', updateAvailability);
      }
      let timeout;
      try {
        await Promise.race([
          Promise.all(clients.map((client) => client.connect())),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Não foi possível conectar ao Redis do tempo real.')),
              REDIS_CONNECT_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      io.adapter(
        createAdapter(clients[0], clients[1], {
          key: app.config.SOCKET_REDIS_PREFIX ?? 'flow-crm:socket.io',
          publishOnSpecificResponseChannel: true,
        }),
      );
      available = true;
    }
  } catch (error) {
    clients.forEach((client) => client.disconnect());
    await io.close();
    throw error;
  }

  app.decorate('realtime', { io, isReady: () => available });
  app.addHook('preClose', async () => {
    stopping = true;
    for (const namespace of namespaces) {
      namespace.local.disconnectSockets(true);
    }
    io.engine.close();
  });
  app.addHook('onClose', async () => {
    await io.close();
    clients.forEach((client) => client.disconnect());
  });
}
