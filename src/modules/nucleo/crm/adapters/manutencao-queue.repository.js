import { Queue } from 'bullmq';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { MANUTENCAO_FILA, PURGA_LIXEIRA } from '../constants.js';

/**
 * ADAPTER: agenda os jobs de manutenção do CRM na fila (BullMQ) — hoje, a
 * purga diária da lixeira (M5). O consumidor é `src/workers/crm.worker.js`,
 * que chama isto ao subir: `upsertJobScheduler` é idempotente, então
 * reiniciar o worker (ou subir mais de um) não duplica o agendamento.
 *
 * @param {string} redisUrl
 */
export async function agendarPurgaDiaria(redisUrl) {
  const fila = new Queue(MANUTENCAO_FILA, { connection: criarConexaoRedis({ paraWorker: true, redisUrl }) });
  try {
    await fila.upsertJobScheduler(
      PURGA_LIXEIRA.AGENDAMENTO_ID,
      { pattern: PURGA_LIXEIRA.CRON, tz: PURGA_LIXEIRA.FUSO },
      { name: PURGA_LIXEIRA.JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  } finally {
    await fila.close();
  }
}
