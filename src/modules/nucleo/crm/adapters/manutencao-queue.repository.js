import { Queue } from 'bullmq';
import { criarConexaoRedis } from '#core/queue/connection.js';
import {
  MANUTENCAO_FILA,
  NOTIFICACAO_ESFRIANDO,
  PURGA_LIXEIRA,
  SNAPSHOT_FORECAST,
} from '../constants.js';

/**
 * ADAPTER: agenda os jobs de manutenção do CRM na fila (BullMQ) — a purga
 * diária da lixeira (M5), o resumo de leads esfriando, de hora em hora
 * (M9), e o snapshot semanal do forecast, também de hora em hora (FC3). O
 * consumidor é `src/workers/crm.worker.js`, que chama isto ao
 * subir: `upsertJobScheduler` é idempotente, então reiniciar o worker (ou
 * subir mais de um) não duplica o agendamento.
 */

/**
 * @param {string} redisUrl
 * @param {string} agendamentoId
 * @param {{ pattern: string, tz?: string }} repeticao
 * @param {string} nomeDoJob
 */
async function agendar(redisUrl, agendamentoId, repeticao, nomeDoJob) {
  const fila = new Queue(MANUTENCAO_FILA, {
    connection: criarConexaoRedis({ paraWorker: true, redisUrl }),
  });
  try {
    await fila.upsertJobScheduler(agendamentoId, repeticao, {
      name: nomeDoJob,
      opts: { removeOnComplete: true, removeOnFail: true },
    });
  } finally {
    await fila.close();
  }
}

/** @param {string} redisUrl */
export function agendarPurgaDiaria(redisUrl) {
  return agendar(
    redisUrl,
    PURGA_LIXEIRA.AGENDAMENTO_ID,
    { pattern: PURGA_LIXEIRA.CRON, tz: PURGA_LIXEIRA.FUSO },
    PURGA_LIXEIRA.JOB,
  );
}

/**
 * De hora em hora, sem fuso: cada tenant decide pelo próprio fuso
 * (`notificarLeadsEsfriando`).
 *
 * @param {string} redisUrl
 */
export function agendarNotificacaoEsfriando(redisUrl) {
  return agendar(
    redisUrl,
    NOTIFICACAO_ESFRIANDO.AGENDAMENTO_ID,
    { pattern: NOTIFICACAO_ESFRIANDO.CRON },
    NOTIFICACAO_ESFRIANDO.JOB,
  );
}

/**
 * De hora em hora, sem fuso: cada tenant decide pelo próprio fuso
 * (`executarSnapshotsDoForecast`, FC3).
 *
 * @param {string} redisUrl
 */
export function agendarSnapshotSemanal(redisUrl) {
  return agendar(
    redisUrl,
    SNAPSHOT_FORECAST.AGENDAMENTO_ID,
    { pattern: SNAPSHOT_FORECAST.CRON },
    SNAPSHOT_FORECAST.JOB,
  );
}
