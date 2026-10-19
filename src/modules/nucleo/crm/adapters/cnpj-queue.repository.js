import { setTimeout, clearTimeout } from 'node:timers';
import { Queue } from 'bullmq';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { CNPJ_FILA, ENRIQUECIMENTO_CNPJ } from '../constants.js';

/**
 * ADAPTER: produtor da fila de enriquecimento por CNPJ (M11b). O
 * consumidor é `src/workers/crm.worker.js`, com rate limit por provedor.
 * Como a fila de import, criada sob demanda: sem `REDIS_URL` o servidor
 * sobe normal — e aqui o erro nem chega ao usuário (o service engole).
 */

/** @type {Queue | null} */
let fila = null;

function obterFila() {
  if (!fila) {
    fila = new Queue(CNPJ_FILA, { connection: criarConexaoRedis() });
    fila.on('error', () => {});
  }
  return fila;
}

/**
 * `jobId` = tenant_lead_cnpj: o mesmo lead com o mesmo CNPJ não entra
 * duas vezes enquanto o job anterior está na fila. Sem `:` — o BullMQ só
 * tolera `:` em id por compatibilidade e marca pra proibir. Erro
 * transitório do provedor é tentado de novo com espera exponencial.
 *
 * @param {{ tenantId: string, leadId: string, cnpj: string }[]} itens
 */
export async function enfileirarEnriquecimentos(itens) {
  if (itens.length === 0) return;
  const adicionar = obterFila().addBulk(
    itens.map((item) => ({
      name: ENRIQUECIMENTO_CNPJ.JOB,
      data: item,
      opts: {
        jobId: `${item.tenantId}_${item.leadId}_${item.cnpj}`,
        attempts: ENRIQUECIMENTO_CNPJ.TENTATIVAS,
        backoff: { type: 'exponential', delay: ENRIQUECIMENTO_CNPJ.ESPERA_INICIAL_MS },
        removeOnComplete: true,
        removeOnFail: true,
      },
    })),
  );

  let timeout;
  const limite = new Promise((_, rejeitar) => {
    timeout = setTimeout(
      () => rejeitar(new Error('Tempo esgotado ao enfileirar enriquecimento de CNPJ')),
      ENRIQUECIMENTO_CNPJ.TIMEOUT_ENFILEIRAR_MS,
    );
  });

  try {
    await Promise.race([adicionar, limite]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function encerrarFilaCnpj() {
  if (fila) {
    await fila.close();
    fila = null;
  }
}
