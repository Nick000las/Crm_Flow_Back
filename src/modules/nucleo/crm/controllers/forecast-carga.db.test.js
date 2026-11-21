import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { TenantManagement } from '#core/tenant/management.js';
import { FUSO_HORARIO_PADRAO, HTTP_STATUS } from '#shared/constants/index.js';
import { CATEGORIAS_STATUS, CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FC2 (docs/produto/crm-forecast.md): teste de carga do
 * forecast com 20 mil oportunidades. GRAVA no banco de `DATABASE_URL` (tenant
 * SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1` e `CRM_CARGA=1`, fora da
 * bateria normal.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.CRM_CARGA === '1' && process.env.DATABASE_URL
    ? describe
    : describe.skip;

const TIMEOUT_MS = 600_000;
const TAMANHO_SUFIXO = 8;
const TOTAL_OPORTUNIDADES = 20_000;
const TOTAL_PESSOAS = 2000;
const PEDIDOS_TOTAL = 30;
const PEDIDOS_RESPONSAVEL = 10;
const LIMITE_P95_MS = 500;
const PERCENTIL = 0.95;
const MEDIANA = 0.5;
const CASAS_DECIMAIS = 1;
const INDENTACAO_JSON = 2;

const formatarMs = (valor) => `${valor.toFixed(CASAS_DECIMAIS)} ms`;

/** Percentil por posto mais próximo, sobre amostras em ms. */
function percentil(amostras, fracao) {
  const ordenadas = [...amostras].sort((a, b) => a - b);
  const posicao = Math.ceil(fracao * ordenadas.length) - 1;
  return ordenadas[Math.max(0, posicao)];
}

rodar('FC2: carga do forecast (CRM_DB_TESTS=1 CRM_CARGA=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let vendas;

  async function chamar(url) {
    const token = app.jwt.access.sign({ tenantId, userId: donoId, role: 'DONO' });
    const inicio = performance.now();
    const resposta = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    const duracao = performance.now() - inicio;
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data, duracao };
  }

  /** Mede `quantidade` pedidos sem acertar o cache (cache zerado antes de cada um). */
  async function medir(url, quantidade) {
    const amostras = [];
    for (let i = 0; i < quantidade; i += 1) {
      await encerrarCache();
      const resposta = await chamar(url);
      expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(HTTP_STATUS.OK);
      amostras.push(resposta.duracao);
    }
    return amostras;
  }

  async function semear() {
    const { status } = (await chamar('/crm/configuracoes/pipelines')).dados.find(
      (p) => p.id === vendas.id,
    );
    const chaves = (categoria) => status.filter((s) => s.category === categoria).map((s) => s.key);
    const abertos = chaves(CATEGORIAS_STATUS.ABERTO);
    const [ganho] = chaves(CATEGORIAS_STATUS.GANHO);
    const [perdido] = chaves(CATEGORIAS_STATUS.PERDIDO);
    expect(abertos.length).toBeGreaterThan(0);

    await prisma.$executeRaw`
      INSERT INTO modulo_crm.leads (tenant_id, nome, email)
      SELECT ${tenantId}::uuid, 'Pessoa ' || g, g || '-' || ${tenantId}::text || '@smoke.test'
      FROM generate_series(1, ${TOTAL_PESSOAS}::int) g
    `;
    // Resto 0..5 aberta (60%), 6..8 ganha (30%), 9 perdida (10%).
    await prisma.$executeRaw`
      WITH pessoas AS (
        SELECT id, row_number() OVER (ORDER BY id) AS rn
        FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid
      ), base AS (
        SELECT g, g % 10 AS r, p.id AS lead_id
        FROM generate_series(1, ${TOTAL_OPORTUNIDADES}::int) g
        JOIN pessoas p ON p.rn = (g % ${TOTAL_PESSOAS}::int) + 1
      )
      INSERT INTO modulo_crm.crm_deal (
        tenant_id, lead_id, pipeline_id, title, status, status_category, amount,
        expected_close_date, won_at, lost_at, owner_id
      )
      SELECT
        ${tenantId}::uuid, lead_id, ${vendas.id}::uuid, 'Carga ' || g,
        CASE WHEN r <= 5 THEN (${abertos}::text[])[1 + g % ${abertos.length}::int]
             WHEN r <= 8 THEN ${ganho}::text ELSE ${perdido}::text END,
        CASE WHEN r <= 5 THEN 'aberto' WHEN r <= 8 THEN 'ganho' ELSE 'perdido' END,
        CASE WHEN g % 13 = 0 THEN NULL ELSE ((g % 500) + 1) * 10.5 END,
        CASE WHEN r <= 5 AND g % 17 <> 0
             THEN current_date + (((g * 7919) % 460) - 183) END,
        CASE WHEN r BETWEEN 6 AND 8 THEN localtimestamp - ((g * 31) % 180) * interval '1 day' END,
        CASE WHEN r = 9 THEN localtimestamp - ((g * 17) % 180) * interval '1 day' END,
        CASE WHEN g % 2 = 0 THEN ${donoId}::uuid ELSE ${operadorId}::uuid END
      FROM base
    `;
    await prisma.$executeRaw`ANALYZE modulo_crm.crm_deal`;
    await prisma.$executeRaw`ANALYZE modulo_crm.leads`;
    await prisma.$executeRaw`ANALYZE modulo_crm.crm_option`;
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE forecast carga',
        subdomain: `smoke-fcc-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });
    await prisma.usuario.createMany({
      data: [
        { id: donoId, role: 'DONO' },
        { id: operadorId, role: 'OPERADOR' },
      ].map(({ id, role }) => ({
        id,
        tenantId,
        nome: 'Usuário',
        email: `${id}@smoke.test`,
        senhaHash: 'test',
        role,
      })),
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.createMany({
      data: [CRM_FEATURES.PERMISSOES, CRM_FEATURES.QUADRO_COMERCIAL].map((featureKey) => ({
        tenantId,
        moduleKey: MODULO_CRM,
        featureKey,
      })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    app = await buildApp({
      config: {
        APP_NAME: 'crm-forecast-carga',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    await TenantManagement.atualizarFeaturesTenant(tenantId, [
      CRM_FEATURES.PERMISSOES,
      CRM_FEATURES.QUADRO_COMERCIAL,
      CRM_FEATURES.FORECAST,
    ]);
    [vendas] = (await chamar('/crm/configuracoes/pipelines')).dados;
    await semear();
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  it('semeou as 20 mil oportunidades', async () => {
    const [{ total }] = await prisma.$queryRaw`
      SELECT count(*)::int AS total FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(total).toBe(TOTAL_OPORTUNIDADES);
  });

  it('EXPLAIN (ANALYZE, BUFFERS) de uma consulta equivalente à agregada (informativo)', async () => {
    const plano = await prisma.$queryRaw`
      EXPLAIN (ANALYZE, BUFFERS)
      WITH ctx AS (SELECT (now() AT TIME ZONE ${FUSO_HORARIO_PADRAO})::date AS hoje)
      SELECT
        date_trunc('month', (d.won_at AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO_HORARIO_PADRAO}) AS mes_ganho,
        date_trunc('month', d.expected_close_date) AS mes_previsto,
        d.status_category,
        count(*) AS quantidade,
        sum(coalesce(d.amount, 0)) AS soma,
        round(sum(d.amount * coalesce(d.probability_override, o.default_probability) / 100.0), 2) AS ponderado,
        count(*) FILTER (WHERE d.amount IS NULL) AS sem_valor,
        count(*) FILTER (WHERE d.expected_close_date < ctx.hoje) AS atrasadas,
        count(*) FILTER (WHERE d.expected_close_date IS NULL) AS sem_previsao
      FROM modulo_crm.crm_deal d
      JOIN modulo_crm.crm_pipeline pl ON pl.tenant_id = d.tenant_id AND pl.id = d.pipeline_id
      JOIN modulo_crm.crm_option o ON o.tenant_id = d.tenant_id AND o.kind = 'status'
        AND o.pipeline_id = d.pipeline_id AND o.key = d.status
      JOIN modulo_crm.leads l ON l.tenant_id = d.tenant_id AND l.id = d.lead_id
      CROSS JOIN ctx
      WHERE d.tenant_id = ${tenantId}::uuid
        AND pl.type = 'sales' AND pl.is_active
        AND d.deleted_at IS NULL AND d.archived_at IS NULL
        AND l.deleted_at IS NULL AND l.archived_at IS NULL
        AND d.status_category IN ('aberto', 'ganho')
      GROUP BY GROUPING SETS ((mes_ganho, status_category), (mes_previsto, status_category), (status_category))
    `;
    const texto = plano.map((linha) => linha['QUERY PLAN']).join('\n');
    console.info(`\n[carga] EXPLAIN (ANALYZE, BUFFERS):\n${texto}\n`);
    console.info(
      `[carga] usa idx_crm_deal_previsao/ganhas: ${/idx_crm_deal_(previsao|ganhas)/.test(texto)}`,
    );
    expect(texto.length).toBeGreaterThan(0);
  });

  it('GET /crm/forecast agrupar=total: p95 abaixo de 500 ms sem cache', async () => {
    // Aquecimento: conexão, plano preparado e módulos carregados.
    await chamar('/crm/forecast');
    const amostras = await medir('/crm/forecast?agrupar=total', PEDIDOS_TOTAL);
    const p95 = percentil(amostras, PERCENTIL);
    const mediana = percentil(amostras, MEDIANA);
    console.info(
      `[carga] total x${PEDIDOS_TOTAL}: mediana ${formatarMs(mediana)}, p95 ${formatarMs(p95)}, ` +
        `max ${formatarMs(Math.max(...amostras))}`,
    );
    const resposta = await chamar('/crm/forecast?agrupar=total');
    expect(resposta.dados.vazio).toBe(false);
    expect(p95).toBeLessThan(LIMITE_P95_MS);
  });

  it('GET /crm/forecast agrupar=responsavel: registra os tempos', async () => {
    const amostras = await medir('/crm/forecast?agrupar=responsavel', PEDIDOS_RESPONSAVEL);
    console.info(
      `[carga] responsavel x${PEDIDOS_RESPONSAVEL}: mediana ${formatarMs(percentil(amostras, MEDIANA))}, ` +
        `p95 ${formatarMs(percentil(amostras, PERCENTIL))}`,
    );
    const resposta = await chamar('/crm/forecast?agrupar=responsavel');
    expect(resposta.dados.grupos.length).toBeGreaterThan(0);
    console.info(JSON.stringify(resposta.dados.blocos, null, INDENTACAO_JSON));
  });
});
