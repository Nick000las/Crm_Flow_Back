import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { registrarAtividade } from './atividades.service.js';
import { criarNovaDefinicao } from './field-definitions.service.js';
import { atualizarLeadExistente, registrarNovoLead } from './leads.service.js';
import { anonimizarLeadDoTitular, obterConfigLgpd, salvarConfigLgpd } from './lgpd.service.js';
import { mesclarLeads } from './mesclagem.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Base legal LGPD (M15) contra o Postgres de verdade: os carimbos (origem,
 * data da base legal, opt-out), a base padrão, a obrigatoriedade pelo campo,
 * os CHECKs da migration 0028 e a anonimização (lead, mesclado, atividades,
 * histórico, audit_log — que a exclusão do tenant apaga em cascata, 0029).
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE lgpd", apagado no fim)
 * — só roda com `CRM_DB_TESTS=1`, num banco de dev. Exige a 0028.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const ORDEM_APELIDO = 60;
const ORDEM_SALARIO = 61;
const SALARIO = 5000;
const DOIS_LEADS = 2; // o lead e o mesclado nele
/** No Neon, a conexão fria e a latência passam fácil dos 5 s padrão. */
const TIMEOUT_MS = 60_000;

rodar('base legal LGPD no banco (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE lgpd', subdomain: `smoke-lgpd-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.create({
      data: { id: donoId, tenantId, nome: 'Dono', email: `smoke-${donoId}@smoke.test`, role: 'DONO', ativo: true },
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({ data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.LGPD } });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it('lead manual: origem "manual", base padrão com data, opt-out com data', async () => {
    await salvarConfigLgpd(tenantId, { basePadrao: 'legitimo_interesse', obrigatoria: false });
    const { id } = await registrarNovoLead(tenantId, { nome: 'Ana', email: 'ana@lgpd.test', optOutMarketing: true }, donoId);
    const lead = await buscarLeadPorId(tenantId, id);
    expect(lead).toMatchObject({ legal_basis: 'legitimo_interesse', origem_registro: 'manual' });
    expect(lead?.legal_basis_at).toBeInstanceOf(Date);
    expect(lead?.marketing_opt_out_at).toBeInstanceOf(Date);
  });

  it('editar: trocar a base renova a data, limpar apaga; opt-out desligado some', async () => {
    const { id } = await registrarNovoLead(tenantId, { nome: 'Bia', email: 'bia@lgpd.test', baseLegal: 'consentimento' }, donoId);
    const antes = await buscarLeadPorId(tenantId, id);

    const trocada = await atualizarLeadExistente(tenantId, id, { baseLegal: 'execucao_contrato', optOutMarketing: true }, donoId);
    expect(trocada.legal_basis).toBe('execucao_contrato');
    expect(trocada.legal_basis_at.getTime()).toBeGreaterThanOrEqual(antes.legal_basis_at.getTime());
    expect(trocada.marketing_opt_out_at).toBeInstanceOf(Date);

    // A mesma base de novo não mexe na data; opt-out ligado de novo mantém a da primeira vez.
    const repetida = await atualizarLeadExistente(tenantId, id, { baseLegal: 'execucao_contrato', optOutMarketing: true }, donoId);
    expect(repetida.legal_basis_at).toEqual(trocada.legal_basis_at);
    expect(repetida.marketing_opt_out_at).toEqual(trocada.marketing_opt_out_at);

    const limpa = await atualizarLeadExistente(tenantId, id, { baseLegal: null, optOutMarketing: false }, donoId);
    expect(limpa.legal_basis).toBeNull();
    expect(limpa.legal_basis_at).toBeNull();
    expect(limpa.marketing_opt_out_at).toBeNull();
  });

  it('obrigatória: sem base nem padrão → 400 no campo; a config liga os campos e vem no GET', async () => {
    await salvarConfigLgpd(tenantId, { basePadrao: null, obrigatoria: true });
    expect(await obterConfigLgpd(tenantId)).toMatchObject({ basePadrao: null, obrigatoria: true });

    await expect(registrarNovoLead(tenantId, { nome: 'Caio', email: 'caio@lgpd.test' }, donoId)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { baseLegal: [expect.any(String)] },
    });
    const { id } = await registrarNovoLead(tenantId, { nome: 'Caio', email: 'caio@lgpd.test', baseLegal: 'outra' }, donoId);
    expect((await buscarLeadPorId(tenantId, id))?.legal_basis).toBe('outra');

    // Com a base padrão, o obrigatório se resolve sozinho no cadastro manual.
    await salvarConfigLgpd(tenantId, { basePadrao: 'consentimento', obrigatoria: true });
    const { id: comPadrao } = await registrarNovoLead(tenantId, { nome: 'Duda', email: 'duda@lgpd.test' }, donoId);
    expect((await buscarLeadPorId(tenantId, comPadrao))?.legal_basis).toBe('consentimento');
  });

  it('anonimizar: some a PII do lead, do mesclado, das atividades e do histórico; fica o rastro', async () => {
    await salvarConfigLgpd(tenantId, { basePadrao: 'consentimento', obrigatoria: false });
    await criarNovaDefinicao(tenantId, { label: 'Apelido', tipo: 'texto', obrigatorio: false, ordem: ORDEM_APELIDO });
    await criarNovaDefinicao(tenantId, { label: 'Salário', tipo: 'numero', obrigatorio: false, ordem: ORDEM_SALARIO });
    const pessoal = { email: 'eva@titular.test', telefone: '11955554444', empresa: 'Eva ME' };
    const { id: eva } = await registrarNovoLead(
      tenantId,
      { nome: 'Eva Titular', ...pessoal, customFields: { apelido: 'Evinha', salario: SALARIO } },
      donoId,
    );
    await atualizarLeadExistente(tenantId, eva, { empresa: 'Eva Ltda', cargo: 'Sócia' }, donoId);
    await registrarAtividade(tenantId, eva, { tipo: 'ligacao', titulo: 'Ligar pra Eva', notas: 'CPF dela no papel' }, donoId);
    const { id: copia } = await registrarNovoLead(tenantId, { nome: 'Eva Cópia', email: 'eva2@titular.test' }, donoId);
    await mesclarLeads(tenantId, { principalId: eva, secundarioId: copia }, donoId);

    const resumo = await anonimizarLeadDoTitular(tenantId, eva, donoId);
    expect(resumo).toMatchObject({ leadId: eva, leads: DOIS_LEADS, atividades: 1 });

    const leads = await prisma.$queryRaw`
      SELECT id::text, nome, email, telefone, empresa, cargo, custom_fields, anonimizado_em, status, legal_basis
      FROM modulo_crm.leads WHERE id IN (${eva}::uuid, ${copia}::uuid)
    `;
    expect(leads).toHaveLength(DOIS_LEADS);
    for (const lead of leads) {
      expect(lead).toMatchObject({ nome: 'Lead anonimizado', email: null, telefone: null, empresa: null, cargo: null });
      expect(lead.anonimizado_em).toBeInstanceOf(Date);
    }
    const principal = leads.find((lead) => lead.id === eva);
    expect(Object.values(principal.custom_fields)).toEqual([SALARIO]); // o número fica; o apelido sai
    expect(principal.legal_basis).toBe('consentimento'); // não é dado pessoal

    const [atividade] = await prisma.$queryRaw`
      SELECT titulo, notas FROM modulo_crm.crm_activity WHERE lead_id = ${eva}::uuid
    `;
    expect(atividade).toEqual({ titulo: 'Atividade anonimizada', notas: null });

    const eventos = await prisma.$queryRaw`
      SELECT tipo, diff::text AS diff, detalhes::text AS detalhes FROM modulo_crm.crm_lead_event
      WHERE lead_id = ${eva}::uuid
    `;
    const texto = eventos.map((evento) => `${evento.diff} ${evento.detalhes}`).join(' ');
    for (const vestigio of ['Eva', 'eva@', 'Evinha', 'Sócia', '11955554444']) expect(texto).not.toContain(vestigio);
    expect(eventos.map((evento) => evento.tipo)).toContain('anonimizado');

    const auditoria = await prisma.$queryRaw`
      SELECT acao, usuario_id::text AS autor FROM audit_log WHERE tenant_id = ${tenantId}::uuid AND entidade_id = ${eva}::uuid
    `;
    expect(auditoria).toEqual([{ acao: 'crm.lead_anonimizado', autor: donoId }]);
    // Append-only: DELETE direto continua barrado (a cascata do tenant, no fim, passa).
    await expect(prisma.$executeRaw`DELETE FROM audit_log WHERE tenant_id = ${tenantId}::uuid`).rejects.toThrow();

    // Travado: editar e anonimizar de novo → 409.
    await expect(atualizarLeadExistente(tenantId, eva, { cargo: 'x' }, donoId)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
    });
    await expect(anonimizarLeadDoTitular(tenantId, eva, donoId)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
  });
});
