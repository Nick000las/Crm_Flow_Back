import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { TenantManagement } from '#core/tenant/management.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CATEGORIAS_STATUS, CRM_FEATURES, MODULO_CRM, TIPOS_PIPELINE } from '../constants.js';
import { reconciliarTenant } from '../services/reconcile.service.js';
import { tirarSnapshotDoTenant } from '../services/forecast-snapshot.service.js';

/**
 * FC3 (docs/crm/plano-execucao-formularios-forecast.md): snapshots semanais do
 * forecast e assertividade, pelo job e pela HTTP. GRAVA no banco de
 * `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`,
 * num banco de dev.
 *
 * O job é chamado direto, com `agora` fixo: a semana é a da primeira segunda-feira
 * do mês real (assim o "mês atual" do snapshot é o mesmo do GET /crm/forecast).
 * Os meses fechados da assertividade são relativos ao mês atual, e os snapshots
 * deles entram direto no banco. O fuso do tenant é America/Sao_Paulo (UTC-3).
 *
 * Cada teste começa sem oportunidades nem snapshots (`beforeEach`).
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const FUSO = 'America/Sao_Paulo';
const MESES_NO_ANO = 12;
const DIGITOS_MES = 2;
const TAMANHO_MES = 7;
const TAMANHO_DATA = 10;
const DIAS_NA_SEMANA = 7;
const DOMINGO_E_SEGUNDA = 8;
const MESES_DO_SNAPSHOT = 4;
const DIAS_ATE_QUARTA = 2;
const MESES_PADRAO_FECHADOS = 6;
const CENTAVOS = 100;
const CASAS_DA_RAZAO = 10_000;
const PADRAO_EDITADO = 33;
const MESES_ATRAS_DO_CENARIO = 2;

const VALOR_ABERTA_DONO_A = 1234.56;
const VALOR_ABERTA_DONO_B = 2000.1;
const VALOR_ABERTA_OPERADOR = 999.99;
const VALOR_ABERTA_SEM_DONO = 500.05;
const VALOR_GANHA_DONO = 3000.3;
const VALOR_GANHA_OPERADOR = 1500.45;
const VALOR_PARA_PROBABILIDADE = 2000;
const GANHA_DONO_FECHADO = 1500;
const GANHA_OPERADOR_FECHADO = 900;
const GANHA_DO_MES_ANTERIOR = 700;
const GANHA_COM_PREVISTO_ZERO = 800;
const SNAPSHOT_REALIZED = '500.00';
const SNAPSHOT_WEIGHTED = '2500.50';
const SNAPSHOT_BEST = '9000.00';
const SNAPSHOT_DONO_WEIGHTED = '1500.25';
const SNAPSHOT_OPERADOR_WEIGHTED = '1000.25';
const PREVISTO_DONO = 2000.25;
const PREVISTO_OPERADOR = 1000.25;
const PREVISTO_TOTAL = 3000.5;
const PONDERADO_ANTIGO = '100.00';
const PONDERADO_VALIDO = '200.00';

const SEM_RESPONSAVEL = 'sem_responsavel';

const emCentavos = (valor) => Math.round(Number(valor) * CENTAVOS);
const razao = (realizado, previsto) =>
  Math.round((realizado / previsto) * CASAS_DA_RAZAO) / CASAS_DA_RAZAO;

const hojeLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
const somarDias = (iso, dias) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, TAMANHO_DATA);
};
const somarMeses = (mes, n) => {
  const [ano, numero] = mes.split('-').map(Number);
  const total = ano * MESES_NO_ANO + (numero - 1) + n;
  const novoMes = String((total % MESES_NO_ANO) + 1).padStart(DIGITOS_MES, '0');
  return `${Math.floor(total / MESES_NO_ANO)}-${novoMes}`;
};
const ultimoDiaDoMes = (mes) => somarDias(`${somarMeses(mes, 1)}-01`, -1);
/** Primeira segunda-feira do mês (sempre entre os dias 1 e 7). */
const primeiraSegunda = (mes) => {
  const diaDaSemana = new Date(`${mes}-01T12:00:00Z`).getUTCDay();
  const dia = 1 + ((DOMINGO_E_SEGUNDA - diaDaSemana) % DIAS_NA_SEMANA);
  return `${mes}-${String(dia).padStart(DIGITOS_MES, '0')}`;
};

rodar(
  'FC3: snapshots e assertividade do forecast (CRM_DB_TESTS=1)',
  { timeout: TIMEOUT_MS },
  () => {
    const prisma = getAdminClient();
    const tenantId = randomUUID();
    const donoId = randomUUID();
    const operadorId = randomUUID();
    const mesAtual = hojeLocal().slice(0, TAMANHO_MES);
    const segunda = primeiraSegunda(mesAtual);
    const COM_FORECAST = [CRM_FEATURES.PERMISSOES, CRM_FEATURES.FORECAST];
    // 05:30 local (antes das 6h) e 06:30 local na segunda; quarta ao meio-dia UTC.
    const SEGUNDA_CEDO = new Date(`${segunda}T08:30:00Z`);
    const SEGUNDA_06H30 = new Date(`${segunda}T09:30:00Z`);
    const QUARTA = new Date(`${somarDias(segunda, DIAS_ATE_QUARTA)}T15:00:00Z`);
    const mesesDoSnapshot = Array.from({ length: MESES_DO_SNAPSHOT }, (_, i) =>
      somarMeses(mesAtual, i),
    );
    // Meses fechados do cenário de assertividade: M (com snapshot), A (antes) e O (depois).
    const mesM = somarMeses(mesAtual, -MESES_ATRAS_DO_CENARIO);
    const mesA = somarMeses(mesM, -1);
    const mesO = somarMeses(mesM, 1);
    const semanaDeM = primeiraSegunda(mesM);
    const semanaDeO = primeiraSegunda(mesO);
    // A semana que começou no mês anterior a O (a última segunda de M).
    const semanaAntesDeO = somarDias(semanaDeO, -DIAS_NA_SEMANA);
    let app;
    let vendas;
    let ganhoKey;

    async function chamar(method, url, payload, { papel = 'DONO', userId = donoId } = {}) {
      const token = app.jwt.access.sign({ tenantId, userId, role: papel });
      const resposta = await app.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${token}` },
      });
      const corpo = resposta.body ? JSON.parse(resposta.body) : null;
      return { status: resposta.statusCode, corpo, dados: corpo?.data };
    }
    const operador = { papel: 'OPERADOR', userId: operadorId };
    const ok = async (promessa, status = HTTP_STATUS.OK) => {
      const resposta = await promessa;
      expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
      return resposta.dados;
    };
    const statusDeVendas = async () => {
      const pipelines = await ok(chamar('GET', '/crm/configuracoes/pipelines'));
      return pipelines.find((p) => p.id === vendas.id).status;
    };
    const abertosDeVendas = async () =>
      (await statusDeVendas()).filter(
        (s) => s.category === CATEGORIAS_STATUS.ABERTO && s.ativo !== false,
      );

    const forecast = (query = {}, quem) =>
      chamar('GET', `/crm/forecast?${new URLSearchParams(query)}`, undefined, quem);
    const assertividade = (query = {}, quem) =>
      chamar('GET', `/crm/forecast/assertividade?${new URLSearchParams(query)}`, undefined, quem);
    const mesDe = (dados, mes) => dados.meses.find((m) => m.mes === mes);

    /** Muda a marca do cache depois de um ajuste cru (que não passa pelo outbox). */
    async function invalidarCache() {
      await prisma.$executeRaw`
      UPDATE modulo_crm.crm_option SET updated_at = clock_timestamp()
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'status'
    `;
    }

    /**
     * Pessoa nova com uma oportunidade pela API. Criar a pessoa já cria uma
     * oportunidade em Novo (apagada aqui) e a nova herda o responsável da pessoa.
     */
    async function criar({ valor, data, status, responsavelId } = {}) {
      const lead = await ok(
        chamar('POST', '/crm/leads', { nome: 'Pessoa', email: `${randomUUID()}@smoke.test` }),
        HTTP_STATUS.CREATED,
      );
      await prisma.$executeRaw`
      DELETE FROM modulo_crm.crm_deal
      WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${lead.id}::uuid
    `;
      const criada = await ok(
        chamar('POST', `/crm/leads/${lead.id}/oportunidades`, {
          ...(status && { status }),
          ...(valor !== undefined && { valor }),
          ...(data && { dataPrevistaFechamento: data }),
          ...(responsavelId && { responsavelId }),
        }),
        HTTP_STATUS.CREATED,
      );
      return criada.id;
    }

    /** Ganha em `ganhaEmUtc` (timestamp sem fuso, em UTC), respeitando chk_crm_deal_datas. */
    async function marcarGanha(id, ganhaEmUtc) {
      await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal
      SET status = ${ganhoKey}, status_category = 'ganho', won_at = ${ganhaEmUtc}::timestamp,
          lost_at = NULL, probability_override = NULL
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
      await invalidarCache();
    }

    async function criarGanha(valor, responsavelId, quando) {
      const id = await criar({ valor, responsavelId });
      await marcarGanha(id, quando);
      return id;
    }

    const lerSnapshots = () => prisma.$queryRaw`
    SELECT to_char(month, 'YYYY-MM') AS mes, week_start::text AS semana,
           realized::text AS realized, weighted::text AS weighted,
           best_case::text AS best_case, won_count, open_count, by_owner
    FROM modulo_crm.crm_forecast_snapshot
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY month
  `;

    /** Snapshot cru de um mês fechado (o job só grava o mês atual em diante). */
    async function inserirSnapshot({
      semana,
      mes,
      realized = '0.00',
      weighted = '0.00',
      bestCase = '0.00',
      byOwner = {},
    }) {
      await prisma.$executeRaw`
      INSERT INTO modulo_crm.crm_forecast_snapshot
        (tenant_id, week_start, month, realized, weighted, best_case,
         won_count, open_count, by_owner, taken_at)
      VALUES (${tenantId}::uuid, ${semana}::date, ${`${mes}-01`}::date,
              ${realized}::numeric, ${weighted}::numeric, ${bestCase}::numeric,
              0, 0, ${JSON.stringify(byOwner)}::jsonb, ${`${semana} 09:00:00`}::timestamp)
    `;
    }

    const donoDoSnapshot = (realized, weighted) => ({
      realized,
      weighted,
      best_case: weighted,
      won_count: 0,
      open_count: 0,
    });

    beforeAll(async () => {
      await prisma.tenant.create({
        data: {
          id: tenantId,
          nome: 'SMOKE forecast FC3',
          subdomain: `smoke-fc3-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
        },
      });
      await prisma.usuario.createMany({
        data: [
          { id: donoId, role: 'DONO' },
          { id: operadorId, role: 'OPERADOR' },
        ].map(({ id, role }) => ({
          id,
          tenantId,
          nome: role === 'DONO' ? 'Dona Maria' : 'Operador João',
          email: `${id}@smoke.test`,
          senhaHash: 'test',
          role,
        })),
      });
      await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
      await prisma.tenantModuleFeature.createMany({
        data: [CRM_FEATURES.PERMISSOES].map((featureKey) => ({
          tenantId,
          moduleKey: MODULO_CRM,
          featureKey,
        })),
      });
      await invalidarFeatures(tenantId);
      await reconciliarTenant(tenantId);
      app = await buildApp({
        config: {
          APP_NAME: 'crm-forecast-fc3',
          NODE_ENV: 'test',
          CORS_ORIGIN: '*',
          JWT_SECRET: 'local-test-secret-access-only',
          JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
        },
      });
      await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
      const pipelines = await ok(chamar('GET', '/crm/configuracoes/pipelines'));
      vendas = pipelines.find((p) => p.tipo === TIPOS_PIPELINE.VENDAS && p.padrao);
      ganhoKey = (await statusDeVendas()).find((s) => s.category === CATEGORIAS_STATUS.GANHO).key;
    });

    beforeEach(async () => {
      await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid`;
      await prisma.$executeRaw`
      DELETE FROM modulo_crm.crm_forecast_snapshot WHERE tenant_id = ${tenantId}::uuid
    `;
      await invalidarCache();
    });

    afterAll(async () => {
      await prisma.$executeRaw`
      DELETE FROM modulo_crm.crm_forecast_snapshot WHERE tenant_id = ${tenantId}::uuid
    `;
      await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
      await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      await app?.close();
      await encerrarCache();
    });

    it('caso 1: antes de segunda 06:00 não grava; às 06:30 grava 4 meses; repetir não duplica', async () => {
      expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_CEDO)).toBe('cedo');
      expect(await lerSnapshots()).toHaveLength(0);

      expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_06H30)).toBe('gravado');
      const linhas = await lerSnapshots();
      expect(linhas.map((l) => l.mes)).toEqual(mesesDoSnapshot);
      for (const linha of linhas) expect(linha.semana).toBe(segunda);

      expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_06H30)).toBe('ja_existia');
      expect(await lerSnapshots()).toHaveLength(MESES_DO_SNAPSHOT);
    });

    it('caso 2: recuperação, sem snapshot na semana uma quarta grava com a segunda daquela semana', async () => {
      expect(await tirarSnapshotDoTenant(tenantId, QUARTA)).toBe('gravado');
      const linhas = await lerSnapshots();
      expect(linhas).toHaveLength(MESES_DO_SNAPSHOT);
      for (const linha of linhas) expect(linha.semana).toBe(segunda);
    });

    it('caso 3: flag crm.forecast desligada não grava nada', async () => {
      await TenantManagement.atualizarFeaturesTenant(tenantId, [CRM_FEATURES.PERMISSOES]);
      try {
        expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_06H30)).toBe('sem_flag');
        expect(await lerSnapshots()).toHaveLength(0);
      } finally {
        await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
      }
    });

    it('caso 4: os valores do snapshot batem com o forecast do mesmo momento, por responsável', async () => {
      const abertos = await abertosDeVendas();
      const data = ultimoDiaDoMes(mesAtual);
      const noMes = `${mesAtual}-01 12:00:00`;
      await criar({
        valor: VALOR_ABERTA_DONO_A,
        data,
        status: abertos[0].key,
        responsavelId: donoId,
      });
      await criar({
        valor: VALOR_ABERTA_DONO_B,
        data,
        status: abertos[1].key,
        responsavelId: donoId,
      });
      await criar({
        valor: VALOR_ABERTA_OPERADOR,
        data,
        status: abertos[0].key,
        responsavelId: operadorId,
      });
      const semDono = await criar({ valor: VALOR_ABERTA_SEM_DONO, data, status: abertos[0].key });
      // A oportunidade nova herda o responsável da pessoa: o "sem responsável" é feito no banco.
      await prisma.$executeRaw`
      UPDATE modulo_crm.crm_deal SET owner_id = NULL
      WHERE id = ${semDono}::uuid AND tenant_id = ${tenantId}::uuid
    `;
      await criarGanha(VALOR_GANHA_DONO, donoId, noMes);
      await criarGanha(VALOR_GANHA_OPERADOR, operadorId, noMes);
      await invalidarCache();

      expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_06H30)).toBe('gravado');
      const [doMes] = (await lerSnapshots()).filter((l) => l.mes === mesAtual);
      const dados = await ok(forecast({ de: mesAtual, ate: mesAtual }));
      const mes = mesDe(dados, mesAtual);

      expect(emCentavos(doMes.realized)).toBe(emCentavos(mes.realizado.soma));
      expect(emCentavos(doMes.weighted)).toBe(emCentavos(mes.ponderado.soma));
      expect(emCentavos(doMes.best_case)).toBe(emCentavos(mes.melhorCaso.soma));
      expect(doMes.won_count).toBe(mes.realizado.quantidade);
      expect(doMes.open_count).toBe(mes.ponderado.quantidade);
      expect(emCentavos(doMes.realized)).toBe(emCentavos(VALOR_GANHA_DONO + VALOR_GANHA_OPERADOR));

      expect(Object.keys(doMes.by_owner).sort()).toEqual(
        [donoId, operadorId, SEM_RESPONSAVEL].sort(),
      );
      const donos = Object.values(doMes.by_owner);
      const somar = (campo) => donos.reduce((total, d) => total + emCentavos(d[campo]), 0);
      expect(somar('realized')).toBe(emCentavos(doMes.realized));
      // Cada nível arredonda o ponderado da própria soma exata: as partes podem
      // diferir do total em até 1 centavo por responsável.
      expect(Math.abs(somar('weighted') - emCentavos(doMes.weighted))).toBeLessThanOrEqual(
        donos.length,
      );
      expect(somar('best_case')).toBe(emCentavos(doMes.best_case));
      expect(donos.reduce((total, d) => total + d.won_count, 0)).toBe(doMes.won_count);
      expect(donos.reduce((total, d) => total + d.open_count, 0)).toBe(doMes.open_count);
      expect(emCentavos(doMes.by_owner[donoId].realized)).toBe(emCentavos(VALOR_GANHA_DONO));
      expect(emCentavos(doMes.by_owner[operadorId].best_case)).toBe(
        emCentavos(VALOR_ABERTA_OPERADOR),
      );
      expect(emCentavos(doMes.by_owner[SEM_RESPONSAVEL].best_case)).toBe(
        emCentavos(VALOR_ABERTA_SEM_DONO),
      );
    });

    it('caso 5: o snapshot é imutável (probabilidade, reabrir, UPDATE com o tenant e com o admin)', async () => {
      const novo = (await abertosDeVendas())[0];
      await criar({
        valor: VALOR_PARA_PROBABILIDADE,
        data: ultimoDiaDoMes(mesAtual),
        status: novo.key,
      });
      const ganha = await criarGanha(VALOR_GANHA_DONO, donoId, `${mesAtual}-01 12:00:00`);
      expect(await tirarSnapshotDoTenant(tenantId, SEGUNDA_06H30)).toBe('gravado');
      const antes = await lerSnapshots();
      const forecastAntes = await ok(forecast({ de: mesAtual, ate: mesAtual }));

      // Mudar a probabilidade padrão muda o forecast e não o snapshot.
      const editado =
        novo.probabilidadePadrao === PADRAO_EDITADO ? PADRAO_EDITADO + 1 : PADRAO_EDITADO;
      const url = `/crm/configuracoes/pipelines/${vendas.id}/status/${novo.id}`;
      await ok(chamar('PUT', url, { probabilidadePadrao: editado }));
      try {
        const forecastDepois = await ok(forecast({ de: mesAtual, ate: mesAtual }));
        expect(mesDe(forecastDepois, mesAtual).ponderado.soma).not.toBe(
          mesDe(forecastAntes, mesAtual).ponderado.soma,
        );
        expect(await lerSnapshots()).toEqual(antes);
      } finally {
        await ok(chamar('PUT', url, { probabilidadePadrao: novo.probabilidadePadrao }));
      }

      // Reabrir uma ganha muda o forecast e não o snapshot.
      await ok(chamar('PATCH', `/crm/oportunidades/${ganha}/status`, { status: novo.key }));
      const reaberto = await ok(forecast({ de: mesAtual, ate: mesAtual }));
      expect(mesDe(reaberto, mesAtual).realizado.quantidade).toBe(0);
      expect(await lerSnapshots()).toEqual(antes);

      // O banco recusa UPDATE, com o cliente do tenant e com o admin (trigger).
      await expect(
        getTenantClient(
          tenantId,
          (tx) => tx.$executeRaw`
          UPDATE modulo_crm.crm_forecast_snapshot SET realized = 1
          WHERE tenant_id = ${tenantId}::uuid
        `,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`
        UPDATE modulo_crm.crm_forecast_snapshot SET realized = 1
        WHERE tenant_id = ${tenantId}::uuid
      `,
      ).rejects.toThrow();
      expect(await lerSnapshots()).toEqual(antes);
    });

    it('caso 6: assertividade de um mês fechado, por responsável, com mês sem dados', async () => {
      await inserirSnapshot({
        semana: semanaDeM,
        mes: mesM,
        realized: SNAPSHOT_REALIZED,
        weighted: SNAPSHOT_WEIGHTED,
        bestCase: SNAPSHOT_BEST,
        byOwner: {
          [donoId]: donoDoSnapshot('500.00', SNAPSHOT_DONO_WEIGHTED),
          [operadorId]: donoDoSnapshot('0.00', SNAPSHOT_OPERADOR_WEIGHTED),
        },
      });
      await criarGanha(GANHA_DONO_FECHADO, donoId, `${mesM}-10 15:00:00`);
      await criarGanha(GANHA_OPERADOR_FECHADO, operadorId, `${mesM}-12 15:00:00`);
      await criarGanha(GANHA_DO_MES_ANTERIOR, donoId, `${mesA}-10 15:00:00`);
      await invalidarCache();

      const dados = await ok(assertividade({ de: mesA, ate: mesO }));
      expect(dados.fuso).toBe(FUSO);
      expect(dados.periodo).toEqual({ de: mesA, ate: mesO });
      expect(dados.meses.map((m) => m.mes)).toEqual([mesO, mesM, mesA]);

      const realizado = GANHA_DONO_FECHADO + GANHA_OPERADOR_FECHADO;
      const setembro = mesDe(dados, mesM);
      expect(setembro.semDados).toBe(false);
      expect(setembro.snapshot.semana).toBe(semanaDeM);
      expect(emCentavos(setembro.previsto)).toBe(emCentavos(PREVISTO_TOTAL));
      expect(emCentavos(setembro.realizadoNoSnapshot)).toBe(emCentavos(SNAPSHOT_REALIZED));
      expect(emCentavos(setembro.ponderadoNoSnapshot)).toBe(emCentavos(SNAPSHOT_WEIGHTED));
      expect(emCentavos(setembro.realizado)).toBe(emCentavos(realizado));
      expect(setembro.assertividade).toBe(razao(realizado, PREVISTO_TOTAL));

      expect(setembro.porResponsavel.map((r) => r.responsavelId)).toEqual([donoId, operadorId]);
      const [doDono, doOperador] = setembro.porResponsavel;
      expect(doDono.rotulo).toBe('Dona Maria');
      expect(emCentavos(doDono.previsto)).toBe(emCentavos(PREVISTO_DONO));
      expect(emCentavos(doDono.realizado)).toBe(emCentavos(GANHA_DONO_FECHADO));
      expect(doDono.assertividade).toBe(razao(GANHA_DONO_FECHADO, PREVISTO_DONO));
      expect(doOperador.rotulo).toBe('Operador João');
      expect(emCentavos(doOperador.previsto)).toBe(emCentavos(PREVISTO_OPERADOR));
      expect(emCentavos(doOperador.realizado)).toBe(emCentavos(GANHA_OPERADOR_FECHADO));
      expect(doOperador.assertividade).toBe(razao(GANHA_OPERADOR_FECHADO, PREVISTO_OPERADOR));

      const agosto = mesDe(dados, mesA);
      expect(agosto.semDados).toBe(true);
      expect(agosto.snapshot).toBeNull();
      expect(agosto.previsto).toBeNull();
      expect(agosto.assertividade).toBeNull();
      expect(agosto.porResponsavel).toEqual([]);
      expect(emCentavos(agosto.realizado)).toBe(emCentavos(GANHA_DO_MES_ANTERIOR));
    });

    it('caso 7: vale o primeiro snapshot dentro do mês; o da semana que começou antes não conta', async () => {
      await inserirSnapshot({ semana: semanaAntesDeO, mes: mesO, weighted: PONDERADO_ANTIGO });
      await inserirSnapshot({ semana: semanaDeO, mes: mesO, weighted: PONDERADO_VALIDO });

      const dados = await ok(assertividade({ de: mesO, ate: mesO }));
      const outubro = mesDe(dados, mesO);
      expect(outubro.semDados).toBe(false);
      expect(outubro.snapshot.semana).toBe(semanaDeO);
      expect(emCentavos(outubro.previsto)).toBe(emCentavos(PONDERADO_VALIDO));

      await prisma.$executeRaw`
      DELETE FROM modulo_crm.crm_forecast_snapshot
      WHERE tenant_id = ${tenantId}::uuid AND week_start = ${semanaDeO}::date
    `;
      const soAntigo = mesDe(await ok(assertividade({ de: mesO, ate: mesO })), mesO);
      expect(soAntigo.semDados).toBe(true);
      expect(soAntigo.snapshot).toBeNull();
      expect(soAntigo.previsto).toBeNull();
    });

    it('caso 8: previsto zero dá assertividade null, mesmo com realizado', async () => {
      await inserirSnapshot({ semana: semanaDeM, mes: mesM });
      await criarGanha(GANHA_COM_PREVISTO_ZERO, donoId, `${mesM}-10 15:00:00`);
      await invalidarCache();

      const dados = await ok(assertividade({ de: mesM, ate: mesM }));
      const mes = mesDe(dados, mesM);
      expect(mes.semDados).toBe(false);
      expect(Number(mes.previsto)).toBe(0);
      expect(emCentavos(mes.realizado)).toBe(emCentavos(GANHA_COM_PREVISTO_ZERO));
      expect(mes.assertividade).toBeNull();
    });

    it('caso 9: acesso (OPERADOR e flag) e validação do período', async () => {
      expect((await assertividade({ de: mesA, ate: mesO }, operador)).status).toBe(
        HTTP_STATUS.FORBIDDEN,
      );

      const noMesAtual = await assertividade({ de: mesA, ate: mesAtual });
      expect(noMesAtual.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(JSON.stringify(noMesAtual.corpo)).toMatch(/"fields":\{"ate"/);

      const invertido = await assertividade({ de: mesO, ate: mesA });
      expect(invertido.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(JSON.stringify(invertido.corpo)).toMatch(/"fields":\{"de"/);

      const padrao = await ok(assertividade());
      const esperados = Array.from({ length: MESES_PADRAO_FECHADOS }, (_, i) =>
        somarMeses(mesAtual, -(i + 1)),
      );
      expect(padrao.periodo).toEqual({ de: esperados.at(-1), ate: esperados[0] });
      expect(padrao.meses.map((m) => m.mes)).toEqual(esperados);

      await TenantManagement.atualizarFeaturesTenant(tenantId, [CRM_FEATURES.PERMISSOES]);
      try {
        expect((await assertividade({ de: mesA, ate: mesO })).status).toBe(HTTP_STATUS.FORBIDDEN);
      } finally {
        await TenantManagement.atualizarFeaturesTenant(tenantId, COM_FORECAST);
      }
      expect((await assertividade({ de: mesA, ate: mesO })).status).toBe(HTTP_STATUS.OK);
    });
  },
);
