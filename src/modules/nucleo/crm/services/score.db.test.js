import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { CRM_FEATURES, FAIXAS_SCORE_PADRAO, MODULO_CRM } from '../constants.js';
import { criarNovaDefinicao, removerDefinicao } from './field-definitions.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { atualizarLeadExistente, pesquisarLeads, registrarNovoLead } from './leads.service.js';
import { reconciliarTenant } from './reconcile.service.js';
import { obterConfigScore, recalcularTodos, salvarConfigScore } from './score.service.js';

/**
 * Pontuação de leads (M14) contra o Postgres de verdade: a expressão SQL
 * do score (a mesma do filtro) ao salvar e no recálculo em lote, o
 * progresso, a idempotência, o filtro por faixa e a regra com campo
 * desligado sendo ignorada.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE score", apagado no fim)
 * — só roda com `CRM_DB_TESTS=1`, num banco de dev. Exige a 0027.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const TAMANHO_PAGINA = 50;
const PAGINA = { pagina: 1, tamanho: TAMANHO_PAGINA };
const ORDEM_SEGMENTO = 60;
/** No Neon, a conexão fria e a latência passam fácil dos 5 s padrão. */
const TIMEOUT_MS = 60_000;

const PONTOS_VIP = 50;
const PONTOS_TELEFONE = 25;
const PONTOS_SEGMENTO = 10;
const PONTOS_DESLIGADA = 100;
const SCORE_ANA = PONTOS_VIP + PONTOS_TELEFONE; // 75: Quente
const LEADS = 2;

rodar('pontuação de leads no banco (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let ana = '';
  let bia = '';
  /** @param {string} id */
  const scoreDe = async (id) => Number((await buscarLeadPorId(tenantId, id))?.lead_score);

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE score', subdomain: `smoke-score-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.create({
      data: { id: donoId, tenantId, nome: 'Dono', email: `smoke-${donoId}@smoke.test`, role: 'DONO', ativo: true },
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({ data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.SCORE } });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    await criarNovaDefinicao(tenantId, { label: 'Segmento', tipo: 'texto', obrigatorio: false, ordem: ORDEM_SEGMENTO });

    // Antes das regras: score 0 (flag ligada, nenhuma regra).
    ({ id: ana } = await registrarNovoLead(tenantId, { nome: 'Ana', email: 'ana@vip.test', telefone: '11988887777' }, donoId));
    ({ id: bia } = await registrarNovoLead(tenantId, { nome: 'Bia', email: 'bia@comum.test', customFields: { segmento: 'varejo' } }, donoId));
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it('salvar as regras recalcula todos (com progresso), e recalcular de novo dá o mesmo', async () => {
    expect(await scoreDe(ana)).toBe(0);
    const { campos } = await obterSchemaCampos(tenantId);
    const id = (chave) => /** @type {{ id: string }} */ (campos.find((campo) => campo.chave === chave)).id;

    const config = await salvarConfigScore(tenantId, {
      regras: [
        { nome: 'E-mail VIP', ativo: true, pontos: PONTOS_VIP, condicoes: [{ campoId: id('email'), operador: 'contem', valor: '@vip.test' }] },
        { nome: 'Tem telefone', ativo: true, pontos: PONTOS_TELEFONE, condicoes: [{ campoId: id('telefone'), operador: 'nao_vazio' }] },
        { nome: 'Varejo', ativo: true, pontos: PONTOS_SEGMENTO, condicoes: [{ campoId: id('segmento'), operador: 'igual', valor: 'varejo' }] },
        { nome: 'Desligada', ativo: false, pontos: PONTOS_DESLIGADA, condicoes: [] },
      ],
      faixas: FAIXAS_SCORE_PADRAO.map((faixa) => ({ ...faixa })),
    });
    expect(config.recalculo).toMatchObject({ total: LEADS, processados: LEADS, emAndamento: false });
    expect(await scoreDe(ana)).toBe(SCORE_ANA);
    expect(await scoreDe(bia)).toBe(PONTOS_SEGMENTO);

    await recalcularTodos(tenantId);
    expect(await scoreDe(ana)).toBe(SCORE_ANA);
    expect(await scoreDe(bia)).toBe(PONTOS_SEGMENTO);
    expect((await obterConfigScore(tenantId)).recalculo).toMatchObject({ processados: LEADS, emAndamento: false });
  });

  it('ao salvar o lead: o score vem na resposta; Lead score no payload → 400', async () => {
    const editada = await atualizarLeadExistente(tenantId, bia, { telefone: '11977776666' }, donoId);
    expect(Number(editada.lead_score)).toBe(PONTOS_SEGMENTO + PONTOS_TELEFONE);
    await expect(atualizarLeadExistente(tenantId, bia, { leadScore: SCORE_ANA }, donoId)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
    });
  });

  it('filtro por faixa', async () => {
    const naFaixa = async (faixaScore) =>
      (await pesquisarLeads(tenantId, { faixaScore, filtros: [], paginacao: PAGINA })).itens.map((lead) => lead.id);
    expect(await naFaixa('quente')).toEqual([ana]);
    expect(await naFaixa('morno')).toEqual([bia]);
    expect(await naFaixa('frio')).toEqual([]);
    await expect(naFaixa('fervendo')).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
  });

  it('regra com campo desligado é ignorada no recálculo', async () => {
    const { definicoes } = await obterSchemaCampos(tenantId);
    const segmento = /** @type {{ id: string }} */ (definicoes.find((definicao) => definicao.chave === 'segmento'));
    await removerDefinicao(tenantId, segmento.id);
    await recalcularTodos(tenantId);
    expect(await scoreDe(bia)).toBe(PONTOS_TELEFONE);
    expect(await scoreDe(ana)).toBe(SCORE_ANA);
  });
});
