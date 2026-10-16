import { criarConexaoRedis } from '#core/queue/connection.js';
import { TIME_UNITS } from '#shared/constants/index.js';

/**
 * Cache chave → valor com TTL, compartilhado pelo core e pelos módulos
 * (flags, schema efetivo de campos, ...).
 *
 * - Com `REDIS_URL`: Redis, então invalidar vale pra todas as instâncias.
 * - Sem `REDIS_URL` (dev/teste): `Map` em memória, por processo.
 *
 * Cache nunca é fonte da verdade: se o Redis falhar, leitura vira miss e
 * escrita/invalidação são ignoradas — quem chama cai no banco. Por isso
 * todo valor precisa de TTL curto o bastante pra tolerar uma invalidação
 * perdida. Valores passam por JSON (só dado serializável).
 */

const PREFIXO = 'cache:';

/**
 * @typedef {object} CacheStore
 * @property {(chave: string) => Promise<unknown>} get  `undefined` = miss
 * @property {(chave: string, valor: unknown, ttlSegundos: number) => Promise<void>} set
 * @property {(chaves: string[]) => Promise<void>} del
 * @property {() => Promise<void>} encerrar
 */

/** @returns {CacheStore} */
export function criarStoreMemoria() {
  /** @type {Map<string, { valor: string, expiraEm: number }>} */
  const mapa = new Map();

  return {
    async get(chave) {
      const item = mapa.get(chave);
      if (!item) return undefined;
      if (item.expiraEm <= Date.now()) {
        mapa.delete(chave);
        return undefined;
      }
      return JSON.parse(item.valor);
    },
    async set(chave, valor, ttlSegundos) {
      mapa.set(chave, {
        valor: JSON.stringify(valor),
        expiraEm: Date.now() + ttlSegundos * TIME_UNITS.MILLISECONDS_PER_SECOND,
      });
    },
    async del(chaves) {
      for (const chave of chaves) mapa.delete(chave);
    },
    async encerrar() {
      mapa.clear();
    },
  };
}

/**
 * @param {import('ioredis').Redis} redis
 * @returns {CacheStore}
 */
export function criarStoreRedis(redis) {
  let avisou = false;
  // Sem listener, o ioredis trata erro de conexão como exceção não
  // capturada. Um aviso por queda basta — o comportamento já é de miss.
  redis.on('error', (erro) => {
    if (avisou) return;
    avisou = true;
    console.warn(`[cache] Redis indisponível, caindo no banco: ${erro.message}`);
  });
  redis.on('ready', () => {
    avisou = false;
  });

  return {
    async get(chave) {
      try {
        const bruto = await redis.get(PREFIXO + chave);
        return bruto === null ? undefined : JSON.parse(bruto);
      } catch {
        return undefined;
      }
    },
    async set(chave, valor, ttlSegundos) {
      try {
        await redis.set(PREFIXO + chave, JSON.stringify(valor), 'EX', ttlSegundos);
      } catch {
        // miss na próxima leitura — aceitável
      }
    },
    async del(chaves) {
      if (chaves.length === 0) return;
      try {
        await redis.del(...chaves.map((chave) => PREFIXO + chave));
      } catch {
        // o TTL limita quanto tempo o valor velho sobrevive
      }
    },
    async encerrar() {
      redis.disconnect();
    },
  };
}

/** @type {CacheStore | null} */
let store = null;

/** Store escolhido na primeira chamada, conforme `REDIS_URL`. */
function obterStore() {
  if (!store) {
    store = process.env.REDIS_URL ? criarStoreRedis(criarConexaoRedis()) : criarStoreMemoria();
  }
  return store;
}

/**
 * @param {string} chave
 * @returns {Promise<unknown>} `undefined` quando não está em cache
 */
export function cacheGet(chave) {
  return obterStore().get(chave);
}

/**
 * @param {string} chave
 * @param {unknown} valor  qualquer valor serializável em JSON (não `undefined`)
 * @param {number} ttlSegundos
 */
export function cacheSet(chave, valor, ttlSegundos) {
  return obterStore().set(chave, valor, ttlSegundos);
}

/** @param {...string} chaves */
export function cacheDel(...chaves) {
  return obterStore().del(chaves);
}

/**
 * Read-through: devolve o valor em cache ou chama `carregar`, guarda e
 * devolve. Duas requisições simultâneas num miss carregam duas vezes —
 * aceitável pra leituras baratas e idempotentes, que é o uso aqui.
 *
 * @template T
 * @param {string} chave
 * @param {number} ttlSegundos
 * @param {() => Promise<T>} carregar
 * @returns {Promise<T>}
 */
export async function lerComCache(chave, ttlSegundos, carregar) {
  const emCache = await cacheGet(chave);
  if (emCache !== undefined) return /** @type {T} */ (emCache);

  const valor = await carregar();
  await cacheSet(chave, valor, ttlSegundos);
  return valor;
}

/**
 * Fecha a conexão (no `onClose` do app) e esquece o store — a próxima
 * chamada escolhe de novo conforme `REDIS_URL` (usado também em teste).
 */
export async function encerrarCache() {
  const atual = store;
  store = null;
  await atual?.encerrar();
}
