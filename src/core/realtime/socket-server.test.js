import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerRealtime } from './socket-server.js';

describe('infraestrutura de tempo real', () => {
  it('não permite iniciar produção com adapter em memória', async () => {
    const app = Fastify();
    app.decorate('config', { NODE_ENV: 'production', CORS_ORIGIN: '*' });
    await expect(registerRealtime(app)).rejects.toThrow('REDIS_URL é obrigatório');
    await app.close();
  });

  it('permite transporte isolado nos testes e encerra os recursos no shutdown', async () => {
    const app = Fastify();
    app.decorate('config', { NODE_ENV: 'test', CORS_ORIGIN: '*' });
    await registerRealtime(app);
    expect(app.realtime.isReady()).toBe(true);
    await app.ready();
    await expect(app.close()).resolves.toBeUndefined();
  });
});
