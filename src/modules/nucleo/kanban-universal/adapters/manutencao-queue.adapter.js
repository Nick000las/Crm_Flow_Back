/**
 * @file ADAPTER: agenda a varredura diária de vínculos (M6). O consumidor é
 * `src/workers/kanban.worker.js`, que chama isto ao subir: `upsertJobScheduler` é idempotente,
 * então reiniciar o worker não duplica o agendamento.
 */
import { Queue } from 'bullmq';

import { criarConexaoRedis } from '#core/queue/connection.js';

import { VARREDURA_VINCULOS } from '../constants.js';

/**
 * ADAPTER: agenda a varredura diária de vínculos (M6). O consumidor é
 * `src/workers/kanban.worker.js`, que chama isto ao subir: `upsertJobScheduler`
 * é idempotente, então reiniciar o worker não duplica o agendamento.
 *
 * @param {string} redisUrl
 */
export async function agendarVarreduraDiaria(redisUrl) {
  const fila = new Queue(VARREDURA_VINCULOS.FILA, {
    connection: criarConexaoRedis({ paraWorker: true, redisUrl }),
  });

  try {
    await fila.upsertJobScheduler(
      VARREDURA_VINCULOS.AGENDAMENTO_ID,
      { pattern: VARREDURA_VINCULOS.CRON, tz: VARREDURA_VINCULOS.FUSO },
      {
        name: VARREDURA_VINCULOS.JOB,
        opts: { removeOnComplete: true, removeOnFail: true },
      },
    );
  } finally {
    await fila.close();
  }
}
