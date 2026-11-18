import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from './configuracoes-campos.service.js';
import { criarNovaDefinicao } from './field-definitions.service.js';
import {
  atualizarLeadExistente,
  buscarLeadFormatado,
  listarCamposDoTenant,
  registrarNovoLead,
} from './leads.service.js';
import { obterPermissoes, salvarPermissoes } from './permissoes.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * FM1: campo sensível. Marcado em Configurações, some para o OPERADOR na
 * leitura e na escrita, mesmo sem a flag `crm.permissoes`; com a flag, o
 * dono pode liberá-lo. Nome e contato não podem ser sensíveis.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_SUFIXO = 8;
const ORDEM = 60;
const TIMEOUT_MS = 60_000;
const OPERADOR = { papel: 'OPERADOR' };
const DONO = { papel: 'DONO' };

rodar('campo sensível no banco (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let leadId = '';
  let campoId = '';

  const campo = async (chave) =>
    (await listarConfiguracaoCampos(tenantId)).find((item) => item.chave === chave);
  const chavesDoOperador = async () =>
    (await listarCamposDoTenant(tenantId, undefined, OPERADOR)).map((item) => item.chave);

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE campo sensivel',
        subdomain: `smoke-sens-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: donoId,
        tenantId,
        nome: 'Dono',
        email: `${donoId}@smoke.test`,
        role: 'DONO',
        ativo: true,
      },
    });

    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    await criarNovaDefinicao(tenantId, {
      label: 'Alergias',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });

    campoId = (await campo('alergias')).id;

    ({ id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Ana Saúde', email: 'ana@smoke.test', customFields: { alergias: 'Dipirona' } },
      donoId,
      DONO,
    ));
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await encerrarCache();
  });

  it('campo novo nasce não sensível, e o OPERADOR o vê', async () => {
    expect(await campo('alergias')).toMatchObject({
      sensivel: false,
      capacidades: { canBeSensitive: true },
    });

    expect(await chavesDoOperador()).toContain('alergias');
  });

  it('nome e contato não podem ser sensíveis', async () => {
    const email = await campo('email');

    expect(email.capacidades.canBeSensitive).toBe(false);

    await expect(
      atualizarConfiguracaoCampo(tenantId, email.id, { sensivel: true }),
    ).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { sensivel: expect.any(Array) },
    });
  });

  describe('marcado como sensível, sem a flag de permissões', () => {
    beforeAll(async () => {
      await atualizarConfiguracaoCampo(tenantId, campoId, { sensivel: true });
    });

    it('o OPERADOR não vê o campo nem o valor', async () => {
      expect(await chavesDoOperador()).not.toContain('alergias');

      const lead = await buscarLeadFormatado(tenantId, leadId, OPERADOR);

      expect(lead.custom_fields ?? {}).not.toHaveProperty('alergias');
    });

    it('o OPERADOR não grava o campo', async () => {
      await expect(
        atualizarLeadExistente(
          tenantId,
          leadId,
          { customFields: { alergias: 'Nenhuma' } },
          donoId,
          OPERADOR,
        ),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.FORBIDDEN });
    });

    it('o DONO segue vendo o valor', async () => {
      const lead = await buscarLeadFormatado(tenantId, leadId, DONO);

      expect(lead.custom_fields).toMatchObject({ alergias: 'Dipirona' });
    });

    it('a configuração de permissões mostra o campo oculto por padrão', async () => {
      const { campos } = await obterPermissoes(tenantId);

      expect(campos.find((item) => item.id === campoId)).toMatchObject({
        sensivel: true,
        acessos: { OPERADOR: 'hidden' },
      });
    });
  });

  describe('com a flag de permissões, o dono libera o campo', () => {
    beforeAll(async () => {
      await prisma.tenantModuleFeature.create({
        data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.PERMISSOES },
      });

      await invalidarFeatures(tenantId);
    });

    it('sem linha, continua oculto', async () => {
      expect(await chavesDoOperador()).not.toContain('alergias');
    });

    it('liberar grava `edit`, e o OPERADOR passa a ver e editar', async () => {
      await salvarPermissoes(tenantId, { OPERADOR: { [campoId]: 'edit' } });

      const linhas = await prisma.$queryRaw`
        SELECT access FROM modulo_crm.crm_field_permission
        WHERE tenant_id = ${tenantId}::uuid AND field_id = ${campoId}::uuid
      `;

      expect(linhas).toEqual([{ access: 'edit' }]);
      expect(await chavesDoOperador()).toContain('alergias');

      await atualizarLeadExistente(
        tenantId,
        leadId,
        { customFields: { alergias: 'Nenhuma' } },
        donoId,
        OPERADOR,
      );

      const lead = await buscarLeadFormatado(tenantId, leadId, OPERADOR);

      expect(lead.custom_fields).toMatchObject({ alergias: 'Nenhuma' });
    });

    it('voltar ao padrão apaga a linha e oculta de novo', async () => {
      await salvarPermissoes(tenantId, { OPERADOR: {} });
      expect(await chavesDoOperador()).not.toContain('alergias');
    });
  });
});
