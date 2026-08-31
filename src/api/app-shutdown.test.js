import { once } from 'node:events';
import { createConnection } from 'node:net';
import { setTimeout, clearTimeout } from 'node:timers';
import { expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from '#core/config/env.js';

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(),
  getTenantClient: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const SHUTDOWN_DEADLINE_MS = 2000;

it('reinício em desenvolvimento encerra conexão HTTP incompleta sem travar a porta', async () => {
  const config = loadEnv({
    NODE_ENV: 'development',
    JWT_SECRET: 'access-secret-with-at-least-32-characters',
    JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  });
  const app = await buildApp({ config, logger: false });
  let socket;
  let closing;
  let timer;
  try {
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    socket = createConnection({ host: address.hostname, port: Number(address.port) });
    socket.on('error', () => {});
    await once(socket, 'connect');
    // Um cliente conectado que ainda não terminou de enviar seus headers.
    socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');
    closing = app.close();
    await Promise.race([
      closing,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Servidor preso durante o reinício')),
          SHUTDOWN_DEADLINE_MS,
        );
      }),
    ]);
    expect(app.server.listening).toBe(false);
  } finally {
    clearTimeout(timer);
    socket?.destroy();
    await (closing ?? app.close());
  }
});
