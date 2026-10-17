import { setTimeout, clearTimeout } from 'node:timers';
import { Queue } from 'bullmq';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { IMPORT_FILA, IMPORTACAO } from '../constants.js';

/**
 * ADAPTER: produtor da fila de importação (BullMQ). Enfileirar é acesso a
 * um sistema externo de dado — mesmo papel que `adapters/` cumpre pro
 * Postgres (docs/crm/plano-campos-filtros-import-export.md §3.1). O
 * consumidor é `src/workers/crm.worker.js`.
 *
 * A fila é criada sob demanda: o servidor HTTP sobe normalmente sem
 * `REDIS_URL`, e só a confirmação de importação falha.
 */

/** @type {Queue | null} */
let fila = null;

function obterFila() {
  if (!fila) {
    fila = new Queue(IMPORT_FILA, { connection: criarConexaoRedis() });
    // Sem listener, um erro de conexão do ioredis vira "unhandled error
    // event" e derruba o processo HTTP inteiro.
    fila.on('error', () => {});
  }
  return fila;
}

/**
 * `jobId` do BullMQ = id do `import_jobs`, então reenfileirar o mesmo job
 * é idempotente. Uma tentativa só (`attempts: 1`): repetir automaticamente
 * um import parcialmente processado criaria leads duplicados.
 *
 * @param {string} tenantId
 * @param {string} jobId
 */
export async function enfileirarImportacao(tenantId, jobId) {
  const adicionar = obterFila().add(
    'processar',
    { tenantId, jobId },
    { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true },
  );

  let timeout;
  const limite = new Promise((_, rejeitar) => {
    timeout = setTimeout(
      () => rejeitar(new Error('Tempo esgotado ao enfileirar importação')),
      IMPORTACAO.TIMEOUT_ENFILEIRAR_MS,
    );
  });

  try {
    await Promise.race([adicionar, limite]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function encerrarFilaImportacao() {
  if (fila) {
    await fila.close();
    fila = null;
  }
}
