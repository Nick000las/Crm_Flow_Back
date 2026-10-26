import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { avancarRodizio } from '../adapters/crm-rodizio.repository.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { criarGrupo, salvarConfigDistribuicao } from './distribuicao.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { registrarNovoLead } from './leads.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Distribuição automática (M12) contra o Postgres de verdade: o ponteiro
 * do rodízio (FOR UPDATE) serializa criações simultâneas sem colisão, e o
 * lead criado guarda a regra que o atribuiu.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE distribuicao", apagado no
 * fim) — só roda com `CRM_DB_TESTS=1`, num banco de dev. Exige a 0026.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const VENDEDORES = 3;
const POR_VENDEDOR = 10;
const LEADS_DO_SITE = 4;
const LEADS_POR_MEMBRO_DO_GRUPO = 2;
const TIMEOUT_MS = 60_000;

rodar('distribuição automática no banco (CRM_DB_TESTS=1)', () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const vendedores = Array.from({ length: VENDEDORES }, () => randomUUID()).sort();
  const [ana, bruno, carla] = vendedores;

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE distribuicao', subdomain: `smoke-dist-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    for (const [i, id] of vendedores.entries()) {
      await prisma.usuario.create({
        data: { id, tenantId, nome: `Vendedor ${i}`, email: `smoke-${id}@smoke.test`, role: 'OPERADOR', ativo: true },
      });
    }
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({ data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.DISTRIBUICAO } });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
  });

  afterAll(async () => {
    // Leads antes: o responsável não tem cascade e barra o cascade tenant → usuarios.
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it(
    'rodízio concorrente: 30 escolhas simultâneas entre 3 dão exatamente 10 pra cada',
    async () => {
      const escolhas = await Promise.all(
        Array.from({ length: VENDEDORES * POR_VENDEDOR }, () => avancarRodizio(tenantId, 'teste-concorrencia', vendedores)),
      );
      for (const vendedor of vendedores) {
        expect(escolhas.filter((id) => id === vendedor)).toHaveLength(POR_VENDEDOR);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'regra pra grupo: leads simultâneos divididos no grupo, com a regra gravada no lead e o aviso no sino',
    async () => {
      const { campos } = await obterSchemaCampos(tenantId);
      const email = /** @type {{ id: string }} */ (campos.find((campo) => campo.chave === 'email'));
      const grupo = /** @type {{ id: string }} */ (await criarGrupo(tenantId, { nome: 'Site', membros: [ana, bruno] }));
      await salvarConfigDistribuicao(tenantId, {
        ativo: true,
        fallback: 'rodizio_geral',
        regras: [
          {
            nome: 'Leads do site',
            ativo: true,
            condicoes: [{ campoId: email.id, operador: 'contem', valor: '@site.test' }],
            destino: { tipo: 'grupo', id: grupo.id },
          },
        ],
      });

      const criados = await Promise.all(
        Array.from({ length: LEADS_DO_SITE }, (_, i) =>
          registrarNovoLead(tenantId, { nome: `Site ${i}`, email: `l${i}@site.test` }, carla),
        ),
      );
      const leads = await Promise.all(criados.map(({ id }) => buscarLeadPorId(tenantId, id)));
      const responsaveis = leads.map((lead) => lead?.usuario_responsavel_id);
      expect(responsaveis.filter((id) => id === ana)).toHaveLength(LEADS_POR_MEMBRO_DO_GRUPO);
      expect(responsaveis.filter((id) => id === bruno)).toHaveLength(LEADS_POR_MEMBRO_DO_GRUPO);
      expect(leads[0]).toMatchObject({ atribuido_por_regra_nome: 'Leads do site' });

      const [{ total }] = await prisma.$queryRaw`
        SELECT count(*)::int AS total FROM notificacoes
        WHERE tenant_id = ${tenantId}::uuid AND tipo = 'crm.lead_atribuido'
      `;
      expect(total).toBe(LEADS_DO_SITE);

      // Fora da regra: rodízio geral (os 3 vendedores); com responsável escolhido, fica com ele.
      const outro = await registrarNovoLead(tenantId, { nome: 'Indicação', email: 'x@indicacao.test' }, carla);
      expect((await buscarLeadPorId(tenantId, outro.id))?.atribuido_por_regra_id).toBeNull();
      const escolhido = await registrarNovoLead(tenantId, { nome: 'Meu', email: 'meu@site.test', usuarioResponsavelId: carla }, carla);
      expect(await buscarLeadPorId(tenantId, escolhido.id)).toMatchObject({ usuario_responsavel_id: carla, atribuido_por_regra_id: null });
    },
    TIMEOUT_MS,
  );
});
