import { Worker } from 'bullmq';
import { loadEnv } from '#core/config/env.js';
import { disconnectDatabase } from '#core/db/tenantClient.js';
import { criarConexaoRedis } from '#core/queue/connection.js';
import {
  CNPJ_FILA,
  IMPORT_FILA,
  MANUTENCAO_FILA,
  NOTIFICACAO_ESFRIANDO,
  PURGA_LIXEIRA,
} from '#modules/nucleo/crm/constants.js';
import { opcoesDoWorkerCnpj, processarEnriquecimento } from '#modules/nucleo/crm/services/cnpj-enriquecimento.service.js';
import { agendarPurgaDaLixeira, purgarLixeiras } from '#modules/nucleo/crm/services/arquivo.service.js';
import { agendarResumoDeEsfriando, notificarLeadsEsfriando } from '#modules/nucleo/crm/services/inatividade.service.js';
import { processarImportacao } from '#modules/nucleo/crm/services/import.service.js';

/**
 * Entrypoint do worker do CRM — processo separado do HTTP
 * (`pnpm worker:crm`), mesmo papel de um controller: recebe o evento da
 * fila e delega pro service. Três filas:
 *
 * - `crm-import`: importação de planilha
 *   (docs/crm/plano-campos-filtros-import-export.md §3.3). Um job por vez:
 *   cada import já é sequencial por linha, e concorrência aqui só
 *   disputaria o pool do Neon com o servidor HTTP.
 * - `crm-manutencao`: jobs agendados ao subir, despachados pelo nome — a
 *   purga diária da lixeira (M5, docs/crm/plano-configuracoes.md) e o
 *   resumo de leads esfriando, de hora em hora (M9).
 * - `crm-cnpj`: enriquecimento automático por CNPJ (M11b), com rate limit
 *   do provedor; erro transitório volta pra fila com espera crescente.
 */

const FAILURE_EXIT_CODE = 1;

/** Job agendado da fila de manutenção → o que roda e como sai no log. */
const JOBS_DE_MANUTENCAO = Object.freeze({
  [PURGA_LIXEIRA.JOB]: {
    executar: () => purgarLixeiras(),
    resumir: (relatorio) => `purga: ${relatorio.apagados} lead(s) em ${relatorio.tenants} tenant(s)`,
  },
  [NOTIFICACAO_ESFRIANDO.JOB]: {
    executar: () => notificarLeadsEsfriando(),
    resumir: (relatorio) => `esfriando: ${relatorio.notificacoes} notificação(ões) em ${relatorio.tenants} tenant(s)`,
  },
});

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

  const manutencao = new Worker(MANUTENCAO_FILA, (job) => JOBS_DE_MANUTENCAO[job.name]?.executar(), {
    connection: conexao(),
    concurrency: 1,
  });
  manutencao.on('completed', (job, relatorio) => {
    const tipo = JOBS_DE_MANUTENCAO[job.name];
    if (!tipo || !relatorio) return;
    console.info(`[crm-manutencao] ${tipo.resumir(relatorio)}`);
    for (const falha of relatorio.falhas) {
      console.error(`[crm-manutencao] ${job.name} falhou no tenant ${falha.tenantId}: ${falha.erro}`);
    }
  });
  manutencao.on('failed', (job, erro) => console.error(`[crm-manutencao] ${job?.name} falhou:`, erro));
  manutencao.on('error', (erro) => console.error('[crm-manutencao] erro de conexão:', erro));

  // O limiter vale pra fila inteira — uma fila por provedor de CNPJ.
  const cnpj = new Worker(CNPJ_FILA, (job) => processarEnriquecimento(job.data), {
    connection: conexao(),
    ...opcoesDoWorkerCnpj(config),
  });
  cnpj.on('completed', (job, relatorio) => {
    if (relatorio?.resultado === 'enriquecido') {
      console.info(`[crm-cnpj] lead ${job.data.leadId}: ${relatorio.campos.join(', ')}`);
    }
  });
  cnpj.on('failed', (job, erro) => console.error(`[crm-cnpj] lead ${job?.data.leadId} falhou:`, erro.message));
  cnpj.on('error', (erro) => console.error('[crm-cnpj] erro de conexão:', erro));

  await agendarPurgaDaLixeira(config.REDIS_URL);
  await agendarResumoDeEsfriando(config.REDIS_URL);

  const encerrar = async () => {
    await Promise.all([importacao.close(), manutencao.close(), cnpj.close()]);
    await disconnectDatabase();
  };
  process.once('SIGINT', () => void encerrar());
  process.once('SIGTERM', () => void encerrar());

  console.info(`[crm] aguardando jobs nas filas "${IMPORT_FILA}", "${MANUTENCAO_FILA}" e "${CNPJ_FILA}"`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(FAILURE_EXIT_CODE);
});
