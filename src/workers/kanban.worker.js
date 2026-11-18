/**
 * @file Entrypoint do worker do Kanban: processo separado do HTTP (`pnpm worker:kanban`), mesmo
 * papel de um controller. Consome a fila `kanban-manutencao`, com a varredura diária de
 * vínculos (M6). Registra os módulos porque a varredura usa os provedores de entidade.
 */
import { Worker } from 'bullmq';

import { MODULES } from '#api/modules.js';
import { loadEnv } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { registrarModulos } from '#core/registry/modules.js';
import { VARREDURA_VINCULOS } from '#modules/nucleo/kanban-universal/constants.js';
import {
  agendarVarreduraDeVinculos,
  varrerVinculos,
} from '#modules/nucleo/kanban-universal/services/varredura-vinculos.service.js';

/**
 * Entrypoint do worker do Kanban: processo separado do HTTP
 * (`pnpm worker:kanban`), mesmo papel de um controller. Consome a fila
 * `kanban-manutencao`, com a varredura diária de vínculos (M6). Registra os
 * módulos porque a varredura usa os provedores de entidade.
 */

const FAILURE_EXIT_CODE = 1;

async function main() {
  const config = loadEnv();

  registrarModulos(MODULES);

  const manutencao = new Worker(VARREDURA_VINCULOS.FILA, () => varrerVinculos(), {
    connection: criarConexaoRedis({ paraWorker: true, redisUrl: config.REDIS_URL }),
    concurrency: 1,
  });

  manutencao.on('completed', (_job, relatorio) => {
    console.info(
      `[kanban-manutencao] varredura: ${relatorio.removidos} removido(s), ${relatorio.repontados} repontado(s) em ${relatorio.tenants} tenant(s)`,
    );

    for (const falha of relatorio.falhas) {
      console.error(`[kanban-manutencao] falhou no tenant ${falha.tenantId}: ${falha.erro}`);
    }
  });

  manutencao.on('failed', (job, erro) =>
    console.error(`[kanban-manutencao] ${job?.name} falhou:`, erro),
  );

  manutencao.on('error', (erro) => console.error('[kanban-manutencao] erro de conexão:', erro));

  await agendarVarreduraDeVinculos(config.REDIS_URL);

  const encerrar = async () => {
    await manutencao.close();
    await disconnectDatabase();
  };

  process.once('SIGINT', () => void encerrar());
  process.once('SIGTERM', () => void encerrar());

  console.info(`[kanban] aguardando jobs na fila "${VARREDURA_VINCULOS.FILA}"`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(FAILURE_EXIT_CODE);
});
