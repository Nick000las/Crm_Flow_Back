import { Redis } from 'ioredis';

/**
 * Conexão Redis compartilhada pelas filas BullMQ (infra cross-cutting,
 * mesmo critério de `#core/db/tenantClient.js` — não é exclusiva de um
 * módulo). Cada `Queue`/`Worker` recebe a sua própria instância.
 *
 * - Produtor (servidor HTTP): `enableOfflineQueue: false`, pra um Redis
 *   fora do ar falhar rápido no request em vez de segurá-lo pendurado.
 * - Worker: `maxRetriesPerRequest: null`, exigido pelo BullMQ pra
 *   conexões bloqueantes.
 *
 * @param {{ paraWorker?: boolean, redisUrl?: string }} [opcoes]
 * @returns {Redis}
 */
export function criarConexaoRedis({ paraWorker = false, redisUrl = process.env.REDIS_URL } = {}) {
  if (!redisUrl) {
    throw new Error('REDIS_URL não configurado — a fila de jobs não está disponível.');
  }

  return new Redis(
    redisUrl,
    paraWorker ? { maxRetriesPerRequest: null } : { enableOfflineQueue: false },
  );
}
