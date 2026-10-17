import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';
import { IMPORT_JOB_STATUS } from '../constants.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: `modulo_crm.import_jobs` (migration 0010).
 *
 * @typedef {import('../types/index.js').ImportJob} ImportJob
 */

/** Colunas de status (sem `payload`, que pode ser grande). */
const COLUNAS_STATUS = Prisma.sql`
  id, status, estrategia_duplicata, total_linhas, linhas_processadas,
  linhas_criadas, linhas_atualizadas, linhas_ignoradas, linhas_com_erro,
  relatorio_erro, created_at, concluido_em
`;

/**
 * @param {string} tenantId
 * @param {{ usuarioId: string, estrategiaDuplicata: string, payload: object[] }} dados
 * @returns {Promise<{ id: string }>}
 */
export function criarImportJob(tenantId, { usuarioId, estrategiaDuplicata, payload }) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      INSERT INTO modulo_crm.import_jobs (tenant_id, usuario_id, estrategia_duplicata, payload, total_linhas)
      VALUES (${tenantId}::uuid, ${usuarioId}::uuid, ${estrategiaDuplicata}, ${JSON.stringify(payload)}::jsonb, ${payload.length})
      RETURNING id
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} jobId
 * @returns {Promise<ImportJob | undefined>}
 */
export function buscarImportJob(tenantId, jobId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT ${COLUNAS_STATUS}
      FROM modulo_crm.import_jobs
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Só pro worker — inclui `payload` e `estrategia_duplicata`.
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @returns {Promise<{ id: string, status: string, estrategia_duplicata: string, payload: object[], usuario_id: string, acoes: Record<string, string> } | undefined>}
 */
export function buscarImportJobComPayload(tenantId, jobId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, status, estrategia_duplicata, payload, usuario_id, acoes
      FROM modulo_crm.import_jobs
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid
    `.then((rows) => rows[FIRST_RESULT_INDEX]),
  );
}

/**
 * Ações escolhidas no Revisar pras linhas duplicadas (M7) — só enquanto o
 * job está `pendente` (antes de confirmar).
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {Record<string, string>} acoes  { "<linha>": "pular" | "atualizar" | "criar" }
 * @returns {Promise<boolean>} se gravou (job existe e está pendente)
 */
export async function definirAcoesDuplicata(tenantId, jobId, acoes) {
  const linhas = await getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.import_jobs SET acoes = ${JSON.stringify(acoes)}::jsonb
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid AND status = ${IMPORT_JOB_STATUS.PENDENTE}
    `,
  );
  return linhas > 0;
}

/**
 * Transição condicional de status (`WHERE status = de`) — duas
 * confirmações simultâneas do mesmo job não enfileiram duas vezes: só a
 * primeira encontra a linha no status de origem.
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {string} de
 * @param {string} para
 * @returns {Promise<boolean>} se a transição aconteceu
 */
export function transicionarStatus(tenantId, jobId, de, para) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      UPDATE modulo_crm.import_jobs
      SET status = ${para}
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid AND status = ${de}
      RETURNING id
    `.then((rows) => rows.length > 0),
  );
}

/**
 * Grava progresso acumulado. `concluir` define o status final e o
 * `concluido_em`.
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {{
 *   linhasProcessadas: number,
 *   linhasCriadas: number,
 *   linhasAtualizadas: number,
 *   linhasIgnoradas: number,
 *   linhasComErro: number,
 *   relatorioErro: object[],
 *   statusFinal?: string,
 * }} progresso
 */
export function registrarProgresso(tenantId, jobId, progresso) {
  const concluido = progresso.statusFinal !== undefined;
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.import_jobs
      SET
        linhas_processadas = ${progresso.linhasProcessadas},
        linhas_criadas = ${progresso.linhasCriadas},
        linhas_atualizadas = ${progresso.linhasAtualizadas},
        linhas_ignoradas = ${progresso.linhasIgnoradas},
        linhas_com_erro = ${progresso.linhasComErro},
        relatorio_erro = ${JSON.stringify(progresso.relatorioErro)}::jsonb,
        status = COALESCE(${progresso.statusFinal ?? null}, status),
        concluido_em = CASE WHEN ${concluido} THEN now() ELSE concluido_em END
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid
    `,
  );
}

/**
 * Marca o job como `falhou` (erro geral, fora de uma linha específica).
 *
 * @param {string} tenantId
 * @param {string} jobId
 */
export function marcarFalha(tenantId, jobId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
      UPDATE modulo_crm.import_jobs
      SET status = ${IMPORT_JOB_STATUS.FALHOU}, concluido_em = now()
      WHERE id = ${jobId}::uuid AND tenant_id = ${tenantId}::uuid
    `,
  );
}
