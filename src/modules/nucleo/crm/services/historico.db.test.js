import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { arquivarLead, desarquivarLead } from './arquivo.service.js';
import { listarHistorico } from './historico.service.js';
import { atualizarLeadExistente, registrarNovoLead } from './leads.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Timeline do lead (M16) contra o Postgres de verdade: o filtro por
 * categoria (em SQL, com o total batendo), os nomes do responsável no diff
 * e a flag `crm.timeline` exigida só pra filtrar.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE timeline", apagado no
 * fim) — só roda com `CRM_DB_TESTS=1`, num banco de dev.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const TAMANHO_PAGINA = 50;
const PAGINA = { pagina: 1, tamanho: TAMANHO_PAGINA };
/** No Neon, a conexão fria e a latência passam fácil dos 5 s padrão. */
const TIMEOUT_MS = 60_000;
const EVENTOS = 5; // criado, empresa, responsável, arquivado, desarquivado
const EVENTOS_DO_CICLO = 3;

rodar('timeline do lead no banco (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const vendedorId = randomUUID();
  let leadId = '';
  /** @param {string[]} [categorias] */
  const historico = (categorias) => listarHistorico(tenantId, leadId, { ...PAGINA, categorias });

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE timeline', subdomain: `smoke-tl-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.createMany({
      data: [
        { id: donoId, tenantId, nome: 'Dona Ana', email: `smoke-${donoId}@smoke.test`, role: 'DONO', ativo: true },
        { id: vendedorId, tenantId, nome: 'Vendedor Bruno', email: `smoke-${vendedorId}@smoke.test`, role: 'OPERADOR', ativo: true },
      ],
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.createMany({
      data: [CRM_FEATURES.ARQUIVO, CRM_FEATURES.TIMELINE].map((featureKey) => ({ tenantId, moduleKey: MODULO_CRM, featureKey })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    ({ id: leadId } = await registrarNovoLead(tenantId, { nome: 'Lead timeline', email: 'tl@smoke.test' }, donoId));
    await atualizarLeadExistente(tenantId, leadId, { status: 'ganho' }, donoId);
    await atualizarLeadExistente(tenantId, leadId, { usuarioResponsavelId: vendedorId }, donoId);
    // Inativo depois: o histórico antigo ainda mostra o nome.
    await prisma.usuario.update({ where: { id: vendedorId }, data: { ativo: false } });
    await arquivarLead(tenantId, leadId, donoId);
    await desarquivarLead(tenantId, leadId, donoId);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it('sem filtro: tudo, cada evento com as suas categorias', async () => {
    const { itens, total } = await historico();
    expect(total).toBe(EVENTOS);
    expect(itens.map((evento) => [evento.tipo, evento.categorias])).toEqual([
      ['desarquivado', ['ciclo']],
      ['arquivado', ['ciclo']],
      ['atualizado', ['campos', 'atribuicao']],
      ['atualizado', ['campos']],
      ['criado', ['ciclo']],
    ]);
  });

  it('atribuição: só a troca de responsável, com os nomes (inativo também)', async () => {
    const { itens, total } = await historico(['atribuicao']);
    expect(total).toBe(1);
    expect(itens[0].diff).toEqual([
      expect.objectContaining({ chave: 'usuarioResponsavelId', antes: donoId, antesNome: 'Dona Ana', depoisNome: 'Vendedor Bruno' }),
    ]);
  });

  it('ciclo de vida, e mais de uma categoria (OU); total bate com a página', async () => {
    const ciclo = await historico(['ciclo']);
    expect(ciclo.itens.map((evento) => evento.tipo)).toEqual(['desarquivado', 'arquivado', 'criado']);
    expect(ciclo.total).toBe(EVENTOS_DO_CICLO);

    const misto = await historico(['ciclo', 'atribuicao']);
    expect(misto.total).toBe(EVENTOS_DO_CICLO + 1);
    expect(await historico(['mesclagem'])).toMatchObject({ itens: [], total: 0 });
  });

  it('filtrar sem a flag crm.timeline → 403 (sem filtro continua)', async () => {
    await prisma.tenantModuleFeature.deleteMany({ where: { tenantId, featureKey: CRM_FEATURES.TIMELINE } });
    await invalidarFeatures(tenantId);
    await expect(historico(['ciclo'])).rejects.toMatchObject({ statusCode: HTTP_STATUS.FORBIDDEN });
    expect((await historico()).total).toBe(EVENTOS);
  });
});
