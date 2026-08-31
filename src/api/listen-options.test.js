import { get } from 'node:http';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { listenOptions } from './listen-options.js';

const API_PORT = 3000;

function status(url) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
}

it('a mesma API local atende localhost IPv4 e IPv6', async () => {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok' }));
  try {
    await app.listen(listenOptions({ NODE_ENV: 'development', HOST: '0.0.0.0', PORT: 0 }));
    const { port } = app.server.address();
    expect(await status(`http://127.0.0.1:${port}/health`)).toBe(HTTP_STATUS.OK);
    expect(await status(`http://[::1]:${port}/health`)).toBe(HTTP_STATUS.OK);
  } finally {
    await app.close();
  }
});

it('produção e interfaces escolhidas explicitamente preservam seu endereço', () => {
  expect(listenOptions({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: API_PORT })).toEqual({
    host: '0.0.0.0',
    port: API_PORT,
  });
  expect(listenOptions({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: API_PORT })).toEqual({
    host: '127.0.0.1',
    port: API_PORT,
  });
});
