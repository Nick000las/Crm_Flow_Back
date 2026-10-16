import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarConexaoRedis } from '#core/queue/connection.js';
import {
  cacheDel,
  cacheGet,
  cacheSet,
  criarStoreMemoria,
  criarStoreRedis,
  encerrarCache,
  lerComCache,
} from './cache.js';

vi.mock('#core/queue/connection.js', () => ({ criarConexaoRedis: vi.fn() }));

const TTL_SEGUNDOS = 30;
const MAIS_QUE_O_TTL_MS = 31_000;

/** Redis falso: só o que o store usa (get/set/del/on/disconnect). */
function criarRedisFalso() {
  const dados = new Map();
  return {
    dados,
    on: vi.fn(),
    get: vi.fn(async (chave) => dados.get(chave) ?? null),
    set: vi.fn(async (chave, valor) => {
      dados.set(chave, valor);
      return 'OK';
    }),
    del: vi.fn(async (...chaves) => chaves.forEach((chave) => dados.delete(chave))),
    disconnect: vi.fn(),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await encerrarCache();
});

describe('store em memória', () => {
  beforeEach(() => vi.useFakeTimers());

  it('guarda, devolve cópia e expira no TTL', async () => {
    const store = criarStoreMemoria();
    const valor = { lista: ['a'] };
    await store.set('k', valor, TTL_SEGUNDOS);

    const lido = await store.get('k');
    expect(lido).toEqual(valor);
    expect(lido).not.toBe(valor); // passa por JSON, igual ao Redis

    vi.advanceTimersByTime(MAIS_QUE_O_TTL_MS);
    await expect(store.get('k')).resolves.toBeUndefined();
  });

  it('del remove só as chaves pedidas', async () => {
    const store = criarStoreMemoria();
    await store.set('a', 1, TTL_SEGUNDOS);
    await store.set('b', 'outro', TTL_SEGUNDOS);
    await store.del(['a']);
    await expect(store.get('a')).resolves.toBeUndefined();
    await expect(store.get('b')).resolves.toBe('outro');
  });

  it('valor falsy guardado não é confundido com miss', async () => {
    const store = criarStoreMemoria();
    await store.set('vazio', [], TTL_SEGUNDOS);
    await store.set('falso', false, TTL_SEGUNDOS);
    await expect(store.get('vazio')).resolves.toEqual([]);
    await expect(store.get('falso')).resolves.toBe(false);
  });
});

describe('store Redis', () => {
  it('prefixa a chave, serializa em JSON e usa EX', async () => {
    const redis = criarRedisFalso();
    const store = criarStoreRedis(redis);

    await store.set('features:t1', ['crm.listas'], TTL_SEGUNDOS);
    expect(redis.set).toHaveBeenCalledWith('cache:features:t1', '["crm.listas"]', 'EX', TTL_SEGUNDOS);
    await expect(store.get('features:t1')).resolves.toEqual(['crm.listas']);

    await store.del(['features:t1']);
    expect(redis.del).toHaveBeenCalledWith('cache:features:t1');
    await expect(store.get('features:t1')).resolves.toBeUndefined();
  });

  it('Redis fora do ar vira miss, sem lançar', async () => {
    const redis = criarRedisFalso();
    const caiu = () => Promise.reject(new Error('ECONNREFUSED'));
    redis.get.mockImplementation(caiu);
    redis.set.mockImplementation(caiu);
    redis.del.mockImplementation(caiu);
    const store = criarStoreRedis(redis);

    await expect(store.get('k')).resolves.toBeUndefined();
    await expect(store.set('k', 1, TTL_SEGUNDOS)).resolves.toBeUndefined();
    await expect(store.del(['k'])).resolves.toBeUndefined();
  });

  it('registra listener de erro (senão o ioredis derruba o processo)', () => {
    const redis = criarRedisFalso();
    criarStoreRedis(redis);
    expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('escolha do store', () => {
  it('sem REDIS_URL usa memória e não abre conexão', async () => {
    vi.stubEnv('REDIS_URL', '');
    await cacheSet('k', 'v', TTL_SEGUNDOS);
    await expect(cacheGet('k')).resolves.toBe('v');
    expect(criarConexaoRedis).not.toHaveBeenCalled();
  });

  it('com REDIS_URL usa o Redis', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const redis = criarRedisFalso();
    criarConexaoRedis.mockReturnValue(redis);

    await cacheSet('k', 'v', TTL_SEGUNDOS);
    await cacheDel('k');

    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('cache:k');

    await encerrarCache();
    expect(redis.disconnect).toHaveBeenCalled();
  });
});

describe('lerComCache', () => {
  it('carrega só no miss', async () => {
    vi.stubEnv('REDIS_URL', '');
    const carregar = vi.fn().mockResolvedValue(['x']);

    await expect(lerComCache('k', TTL_SEGUNDOS, carregar)).resolves.toEqual(['x']);
    await expect(lerComCache('k', TTL_SEGUNDOS, carregar)).resolves.toEqual(['x']);
    expect(carregar).toHaveBeenCalledTimes(1);

    await cacheDel('k');
    await lerComCache('k', TTL_SEGUNDOS, carregar);
    expect(carregar).toHaveBeenCalledTimes(['antes', 'depois da invalidação'].length);
  });
});
