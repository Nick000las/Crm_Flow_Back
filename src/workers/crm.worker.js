import { Worker } from 'bullmq';
import { loadEnv } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { criarConexaoRedis } from '#core/queue/connection.js';
import { IMPORT_FILA, MANUTENCAO_FILA } from '#modules/nucleo/crm/constants.js';
import { agendarPurgaDaLixeira, purgarLixeiras } from '#modules/nucleo/crm/services/arquivo.service.js';
import { processarImportacao } from '#modules/nucleo/crm/services/import.service.js';

/**
 * Entrypoint do worker do CRM — processo separado do HTTP
 * (`pnpm worker:crm`), mesmo papel de um controller: recebe o evento da
 * fila e delega pro service. Duas filas:
 *
 * - `crm-import`: importação de planilha
 *   (docs/crm/plano-campos-filtros-import-export.md §3.3). Um job por vez:
 *   cada import já é sequencial por linha, e concorrência aqui só
 *   disputaria o pool do Neon com o servidor HTTP.
 * - `crm-manutencao`: jobs agendados — a purga diária da lixeira (M5,
 *   docs/crm/plano-configuracoes.md), agendada ao subir.
 */

const FAILURE_EXIT_CODE = 1;

async function main() {
  const config = loadEnv();
  const conexao = () => criarConexaoRedis({ paraWorker: true, redisUrl: config.REDIS_URL });

  const importacao = new Worker(
    IMPORT_FILA,
    (job) => processarImportacao(job.data.tenantId, job.data.jobId),
    { connection: conexao(), concurrency: 1 },
  );
  importacao.on('completed', (job) => console.info(`[crm-import] job ${job.data.jobId} concluído`));
  importacao.on('failed', (job, erro) => console.error(`[crm-import] job ${job?.data.jobId} falhou:`, erro));
  importacao.on('error', (erro) => console.error('[crm-import] erro de conexão:', erro));

  const manutencao = new Worker(MANUTENCAO_FILA, () => purgarLixeiras(), { connection: conexao(), concurrency: 1 });
  manutencao.on('completed', (_job, relatorio) => {
    console.info(`[crm-manutencao] purga: ${relatorio.apagados} lead(s) em ${relatorio.tenants} tenant(s)`);
    for (const falha of relatorio.falhas) {
      console.error(`[crm-manutencao] purga falhou no tenant ${falha.tenantId}: ${falha.erro}`);
    }
  });
  manutencao.on('failed', (_job, erro) => console.error('[crm-manutencao] purga falhou:', erro));
  manutencao.on('error', (erro) => console.error('[crm-manutencao] erro de conexão:', erro));

  await agendarPurgaDaLixeira(config.REDIS_URL);

  const encerrar = async () => {
    await Promise.all([importacao.close(), manutencao.close()]);
    await disconnectDatabase();
  };
  process.once('SIGINT', () => void encerrar());
  process.once('SIGTERM', () => void encerrar());

  console.info(`[crm] aguardando jobs nas filas "${IMPORT_FILA}" e "${MANUTENCAO_FILA}"`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(FAILURE_EXIT_CODE);
});
