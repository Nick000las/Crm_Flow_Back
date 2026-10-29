import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { criarNovaDefinicao } from './field-definitions.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { listarHistorico } from './historico.service.js';
import { editarLeadsEmMassa } from './leads-bulk.service.js';
import {
  atualizarLeadExistente,
  buscarLeadFormatado,
  listarCamposDoTenant,
  pesquisarLeads,
  registrarNovoLead,
} from './leads.service.js';
import { salvarPermissoes } from './permissoes.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Permissão por campo (M13) contra o Postgres de verdade: com o e-mail e
 * um personalizado ocultos e o status "só ver" pro OPERADOR, ele não lê,
 * não filtra, não acha pela busca textual, não vê no histórico e não grava
 * esses campos — e o DONO segue vendo e editando tudo.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE permissoes", apagado no
 * fim) — só roda com `CRM_DB_TESTS=1`, num banco de dev.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const TAMANHO_PAGINA = 50;
const PAGINA = { pagina: 1, tamanho: TAMANHO_PAGINA };
const ORDEM_SALARIO = 50;
const SALARIO = 9000;
const SALARIO_NOVO = 9500;
const TIMEOUT_MS = 60_000;
const OPERADOR = { papel: 'OPERADOR' };
const DONO = { papel: 'DONO' };
const EVENTOS_DO_DONO = 2;

rodar('permissão por campo no banco (CRM_DB_TESTS=1)', () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let leadId = '';

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE permissoes', subdomain: `smoke-perm-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.createMany({
      data: [
        { id: donoId, tenantId, nome: 'Dono', email: `smoke-${donoId}@smoke.test`, role: 'DONO', ativo: true },
        { id: operadorId, tenantId, nome: 'Operador', email: `smoke-${operadorId}@smoke.test`, role: 'OPERADOR', ativo: true },
      ],
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({ data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.PERMISSOES } });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    await criarNovaDefinicao(tenantId, { label: 'Salário', tipo: 'numero', obrigatorio: false, ordem: ORDEM_SALARIO });
    const { campos } = await obterSchemaCampos(tenantId);
    const id = (chave) => /** @type {{ id: string }} */ (campos.find((campo) => campo.chave === chave)).id;
    await salvarPermissoes(tenantId, { OPERADOR: { [id('email')]: 'hidden', [id('salario')]: 'hidden', [id('status')]: 'view' } });

    ({ id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Ana Sigilo', email: 'ana@sigilo.test', telefone: '11988887777', status: 'novo', customFields: { salario: SALARIO } },
      donoId,
      DONO,
    ));
    // Um diff com e-mail e salário no histórico.
    await atualizarLeadExistente(tenantId, leadId, { email: 'ana2@sigilo.test', customFields: { salario: SALARIO_NOVO } }, donoId, DONO);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it(
    'leitura: lead, lista e campos sem o oculto; "só ver" vem marcado',
    async () => {
      const lead = await buscarLeadFormatado(tenantId, leadId, OPERADOR);
      expect(lead).not.toHaveProperty('email');
      expect(lead.custom_fields).not.toHaveProperty('salario');
      expect(lead).toMatchObject({ nome: 'Ana Sigilo', status: 'novo' });

      const { itens } = await pesquisarLeads(tenantId, { filtros: [], paginacao: PAGINA }, OPERADOR);
      expect(itens[0]).not.toHaveProperty('email');

      const campos = await listarCamposDoTenant(tenantId, undefined, OPERADOR);
      expect(campos.map((campo) => campo.chave)).not.toEqual(expect.arrayContaining(['email']));
      expect(campos.find((campo) => campo.chave === 'status')).toMatchObject({ acesso: 'view' });

      // O DONO ignora.
      expect(await buscarLeadFormatado(tenantId, leadId, DONO)).toMatchObject({ email: 'ana2@sigilo.test' });
    },
    TIMEOUT_MS,
  );

  it(
    'filtro e busca textual: campo oculto não filtra nem acha',
    async () => {
      await expect(
        pesquisarLeads(tenantId, { filtros: [{ chave: 'salario', operador: 'entre', valor: { de: 1 } }], paginacao: PAGINA }, OPERADOR),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });

      const peloEmail = await pesquisarLeads(tenantId, { busca: 'ana2@sigilo', filtros: [], paginacao: PAGINA }, OPERADOR);
      expect(peloEmail.total).toBe(0);
      const peloEmailDono = await pesquisarLeads(tenantId, { busca: 'ana2@sigilo', filtros: [], paginacao: PAGINA }, DONO);
      expect(peloEmailDono.total).toBe(1);
      // O que ele vê continua buscável.
      expect((await pesquisarLeads(tenantId, { busca: '98888', filtros: [], paginacao: PAGINA }, OPERADOR)).total).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    'histórico: o diff do oculto não aparece pro OPERADOR (e a edição só de oculto some)',
    async () => {
      const chavesDoDiff = async (acesso) =>
        (await listarHistorico(tenantId, leadId, PAGINA, acesso)).itens.flatMap((evento) => evento.diff.map((entrada) => entrada.chave));
      expect(await chavesDoDiff(DONO)).toEqual(expect.arrayContaining(['email', 'salario']));
      const doOperador = await chavesDoDiff(OPERADOR);
      expect(doOperador).not.toContain('email');
      expect(doOperador).not.toContain('salario');
      // M16: a edição só mexeu em campos ocultos pra ele — some da lista e do total.
      const tipos = async (acesso) => {
        const { itens, total } = await listarHistorico(tenantId, leadId, PAGINA, acesso);
        return { tipos: itens.map((evento) => evento.tipo), total };
      };
      expect(await tipos(DONO)).toEqual({ tipos: ['atualizado', 'criado'], total: EVENTOS_DO_DONO });
      expect(await tipos(OPERADOR)).toEqual({ tipos: ['criado'], total: 1 });
    },
    TIMEOUT_MS,
  );

  it(
    'escrita: "só ver" e oculto → 403 (PUT, criação e massa); o resto ele edita',
    async () => {
      const proibido = { statusCode: HTTP_STATUS.FORBIDDEN };
      await expect(atualizarLeadExistente(tenantId, leadId, { status: 'perdido' }, operadorId, OPERADOR)).rejects.toMatchObject(proibido);
      await expect(
        atualizarLeadExistente(tenantId, leadId, { customFields: { salario: 1 } }, operadorId, OPERADOR),
      ).rejects.toMatchObject(proibido);
      await expect(
        registrarNovoLead(tenantId, { nome: 'Novo', email: 'x@sigilo.test' }, operadorId, OPERADOR),
      ).rejects.toMatchObject(proibido);
      await expect(
        editarLeadsEmMassa(tenantId, { ids: [leadId], alteracoes: { status: 'perdido' } }, operadorId, OPERADOR),
      ).rejects.toMatchObject(proibido);

      const editado = await atualizarLeadExistente(tenantId, leadId, { nome: 'Ana S.' }, operadorId, OPERADOR);
      expect(editado).toMatchObject({ nome: 'Ana S.' });
      expect(editado).not.toHaveProperty('email');
      const criado = await registrarNovoLead(tenantId, { nome: 'Bia', telefone: '11977776666' }, operadorId, OPERADOR);
      expect(criado.id).toEqual(expect.any(String));
    },
    TIMEOUT_MS,
  );
});
