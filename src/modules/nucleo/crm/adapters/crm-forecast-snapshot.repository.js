import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: o snapshot semanal do forecast (FC3, `crm_forecast_snapshot`). A
 * tabela é imutável (trigger): aqui só se grava e se lê. Datas chegam e saem
 * como texto (`AAAA-MM-DD`, `AAAA-MM`); dinheiro sai em texto decimal.
 *
 * @typedef {{
 *   realized: string, weighted: string, best_case: string, won_count: number, open_count: number,
 * }} NumerosDoSnapshot
 * @typedef {NumerosDoSnapshot & { mes: string, by_owner: Record<string, NumerosDoSnapshot> }} LinhaNova
 *   `mes`: primeiro dia do mês (`AAAA-MM-01`)
 * @typedef {{
 *   mes: string, semana: string, tirado_em: Date, realized: string, weighted: string,
 *   by_owner: Record<string, NumerosDoSnapshot>,
 * }} SnapshotGravado  `mes`: `AAAA-MM`; `semana`: `AAAA-MM-DD`
 */

/**
 * @param {string} tenantId
 * @param {string} semana  segunda-feira local (`AAAA-MM-DD`)
 * @returns {Promise<boolean>}
 */
export function existeSnapshotDaSemana(tenantId, semana) {
  return getTenantClient(tenantId, async (tx) => {
    const [{ existe }] = await tx.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM modulo_crm.crm_forecast_snapshot s
        WHERE s.tenant_id = ${tenantId}::uuid AND s.week_start = ${semana}::date
      ) AS existe
    `;
    return existe;
  });
}

/**
 * As linhas da semana numa transação. Já gravada (outro worker, corrida), o
 * `ON CONFLICT` não grava de novo.
 *
 * @param {string} tenantId
 * @param {string} semana  segunda-feira local (`AAAA-MM-DD`)
 * @param {Date} tiradoEm  vai para `taken_at` em UTC
 * @param {LinhaNova[]} linhas
 * @returns {Promise<number>} linhas gravadas
 */
export function gravarSnapshot(tenantId, semana, tiradoEm, linhas) {
  const instante = tiradoEm.toISOString();
  return getTenantClient(tenantId, async (tx) => {
    let gravadas = 0;
    for (const linha of linhas) {
      gravadas += await tx.$executeRaw`
        INSERT INTO modulo_crm.crm_forecast_snapshot (
          tenant_id, week_start, month, realized, weighted, best_case,
          won_count, open_count, by_owner, taken_at
        ) VALUES (
          ${tenantId}::uuid, ${semana}::date, ${linha.mes}::date,
          ${linha.realized}::numeric, ${linha.weighted}::numeric, ${linha.best_case}::numeric,
          ${linha.won_count}::int, ${linha.open_count}::int, ${JSON.stringify(linha.by_owner)}::jsonb,
          ${instante}::timestamptz AT TIME ZONE 'UTC'
        )
        ON CONFLICT (tenant_id, week_start, month) DO NOTHING
      `;
    }
    return gravadas;
  });
}

/**
 * Os snapshots dos meses de `de` a `ate` tirados numa semana que começou
 * dentro do próprio mês, do mais antigo ao mais novo.
 *
 * @param {string} tenantId
 * @param {string} de  primeiro dia do mês
 * @param {string} ate  primeiro dia do mês
 * @returns {Promise<SnapshotGravado[]>}
 */
export function buscarSnapshotsDoPeriodo(tenantId, de, ate) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT to_char(s.month, 'YYYY-MM') AS mes, to_char(s.week_start, 'YYYY-MM-DD') AS semana,
             s.taken_at AS tirado_em, s.realized::text, s.weighted::text, s.by_owner
      FROM modulo_crm.crm_forecast_snapshot s
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.month BETWEEN ${de}::date AND ${ate}::date
        AND s.week_start >= s.month AND s.week_start < (s.month + interval '1 month')
      ORDER BY s.month, s.taken_at, s.week_start
    `,
  );
}
