import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { TenantManagement } from '#core/tenant/management.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  CAMPOS_DO_FORECAST,
  CATEGORIAS_STATUS,
  CRM_FEATURES,
  MODULO_CRM,
  PROBABILIDADE_PADRAO,
} from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { AVISOS_OPORTUNIDADE } from '../services/oportunidade-transicao.service.js';
import { provedorComercial } from '../services/quadro-comercial.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FC1 (docs/crm/plano-execucao-formularios-forecast.md): probabilidade padrão
 * por status, volta ao padrão quando o status muda e a flag `crm.forecast`
 * ligando os campos. GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no
 * fim): só roda com `CRM_DB_TESTS=1`, num banco de dev.
 *
 * O tenant nasce como um tenant real: Data prevista e Probabilidade chegam
 * desligadas, e quem as liga é a flag (aceite), não a preparação.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const OVERRIDE = 60;
const MANDADA = 35;
const PADRAO_EDITADO = 55;
const FORA_DO_FIXO = 90;
const TODOS_OS_CONTEXTOS = Object.freeze({
  create_form: true,
  detail: true,
  table: true,
  filter: true,
});

rodar('FC1: probabilidade padrão (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let vendas;

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
  const pipelines = () => ok(chamar('GET', '/crm/configuracoes/pipelines'));
  const statusDeVendas = async () => (await pipelines()).find((p) => p.id === vendas.id).status;
  const visivelEmTudo = async (chave) => {
    const campo = (await listarConfiguracaoCampos(tenantId)).find((c) => c.chave === chave);
    return Object.values(campo.visibilidade).every(Boolean);
  };

  /** Pessoa com uma oportunidade em Novo, com probabilidade própria. */
  async function oportunidadeComOverride() {
    const lead = await ok(
      chamar('POST', '/crm/leads', { nome: 'Pessoa', email: `${randomUUID()}@smoke.test` }),
      HTTP_STATUS.CREATED,
    );
    const criada = await ok(
      chamar('POST', `/crm/leads/${lead.id}/oportunidades`, {
        status: 'novo',
        probabilidadeFechamento: OVERRIDE,
      }),
      HTTP_STATUS.CREATED,
    );
    return { leadId: lead.id, oportunidade: criada };
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE forecast FC1',
        subdomain: `smoke-fc1-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
        APP_NAME: 'crm-forecast-fc1',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    [vendas] = await pipelines();
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('flag crm.forecast', () => {
    it('ligar a flag liga Data prevista e Probabilidade; desligar mantém os campos', async () => {
      for (const chave of CAMPOS_DO_FORECAST) expect(await visivelEmTudo(chave)).toBe(false);

      await TenantManagement.atualizarFeaturesTenant(tenantId, [
        CRM_FEATURES.PERMISSOES,
        CRM_FEATURES.QUADRO_COMERCIAL,
        CRM_FEATURES.FORECAST,
      ]);
      for (const chave of CAMPOS_DO_FORECAST) expect(await visivelEmTudo(chave)).toBe(true);

      await TenantManagement.atualizarFeaturesTenant(tenantId, [
        CRM_FEATURES.PERMISSOES,
        CRM_FEATURES.QUADRO_COMERCIAL,
      ]);
      for (const chave of CAMPOS_DO_FORECAST) expect(await visivelEmTudo(chave)).toBe(true);
    });

    it('religar a flag com um campo desligado pelo dono liga de novo; manter ligada não', async () => {
      const campos = await listarConfiguracaoCampos(tenantId);
      const data = campos.find((c) => c.chave === 'dataPrevistaFechamento');
      await atualizarConfiguracaoCampo(tenantId, data.id, {
        visibilidade: { ...TODOS_OS_CONTEXTOS, table: false },
      });

      const comForecast = [
        CRM_FEATURES.PERMISSOES,
        CRM_FEATURES.QUADRO_COMERCIAL,
        CRM_FEATURES.FORECAST,
      ];
      await TenantManagement.atualizarFeaturesTenant(tenantId, comForecast);
      expect(await visivelEmTudo('dataPrevistaFechamento')).toBe(true);

      // Já ligada: mexer nas flags de novo não toca no que o dono escolheu.
      await atualizarConfiguracaoCampo(tenantId, data.id, {
        visibilidade: { ...TODOS_OS_CONTEXTOS, table: false },
      });
      await TenantManagement.atualizarFeaturesTenant(tenantId, comForecast);
      expect(await visivelEmTudo('dataPrevistaFechamento')).toBe(false);
      await atualizarConfiguracaoCampo(tenantId, data.id, { visibilidade: TODOS_OS_CONTEXTOS });
    });
  });

  describe('probabilidade padrão do status', () => {
    it('tenant novo: cada status nasce com o padrão, e ganho e perdido são fixos', async () => {
      const status = await statusDeVendas();
      for (const opcao of status) {
        const esperada =
          PROBABILIDADE_PADRAO.FIXA[opcao.category] ??
          PROBABILIDADE_PADRAO.SUGERIDA[opcao.key] ??
          PROBABILIDADE_PADRAO.ABERTO_SEM_SUGESTAO;
        expect(opcao.probabilidadePadrao, opcao.key).toBe(esperada);
      }
    });

    it('o banco espelha as sugestões de PROBABILIDADE_PADRAO, e chave nova aberta nasce em 10', async () => {
      const criados = {};
      for (const label of ['Negociação', 'Demonstração']) {
        const criado = await ok(
          chamar('POST', `/crm/configuracoes/pipelines/${vendas.id}/status`, {
            label,
            category: CATEGORIAS_STATUS.ABERTO,
          }),
          HTTP_STATUS.CREATED,
        );
        criados[criado.key] = criado.probabilidadePadrao;
      }
      expect(criados).toEqual({
        negociacao: PROBABILIDADE_PADRAO.SUGERIDA.negociacao,
        demonstracao: PROBABILIDADE_PADRAO.ABERTO_SEM_SUGESTAO,
      });
    });

    it('a gestão edita o padrão do aberto; ganho e perdido não aceitam outro valor', async () => {
      const status = await statusDeVendas();
      const novo = status.find((s) => s.key === 'novo');
      const ganho = status.find((s) => s.category === CATEGORIAS_STATUS.GANHO);
      const url = (opcao) => `/crm/configuracoes/pipelines/${vendas.id}/status/${opcao.id}`;

      const editado = await ok(chamar('PUT', url(novo), { probabilidadePadrao: PADRAO_EDITADO }));
      expect(editado.probabilidadePadrao).toBe(PADRAO_EDITADO);

      const fixo = await chamar('PUT', url(ganho), { probabilidadePadrao: FORA_DO_FIXO });
      expect(fixo.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(fixo.corpo.error.fields).toHaveProperty('probabilidadePadrao');

      const doOperador = await chamar('PUT', url(novo), { probabilidadePadrao: 1 }, operador);
      expect(doOperador.status).toBe(HTTP_STATUS.FORBIDDEN);

      await ok(
        chamar('PUT', url(novo), { probabilidadePadrao: PROBABILIDADE_PADRAO.SUGERIDA.novo }),
      );
    });

    it('o banco nunca deixa um aberto sem probabilidade nem um ganho fora de 100', async () => {
      const [aberto] = await prisma.$queryRaw`
        UPDATE modulo_crm.crm_option SET default_probability = NULL
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'status' AND key = 'qualificado'
          AND pipeline_id = ${vendas.id}::uuid
        RETURNING default_probability::int AS p
      `;
      expect(aberto.p).toBe(PROBABILIDADE_PADRAO.SUGERIDA.qualificado);

      const [ganho] = await prisma.$queryRaw`
        UPDATE modulo_crm.crm_option SET default_probability = 50
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'status' AND category = 'ganho'
          AND pipeline_id = ${vendas.id}::uuid
        RETURNING default_probability::int AS p
      `;
      expect(ganho.p).toBe(PROBABILIDADE_PADRAO.FIXA.ganho);

      await expect(prisma.$executeRaw`
        UPDATE modulo_crm.crm_option SET default_probability = 10
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'fonte_lead'
      `).rejects.toThrow(/chk_crm_option_probabilidade_status/);
    });
  });

  describe('override volta ao padrão quando o status muda', () => {
    it('PATCH de status: limpa o override, avisa, e a efetiva passa a ser a do status', async () => {
      const { oportunidade } = await oportunidadeComOverride();
      expect(oportunidade.probabilidadeEfetiva).toBe(OVERRIDE);

      const movida = await ok(
        chamar('PATCH', `/crm/oportunidades/${oportunidade.id}/status`, { status: 'proposta' }),
      );
      expect(movida.probabilidadeFechamento).toBeNull();
      expect(movida.probabilidadeEfetiva).toBe(PROBABILIDADE_PADRAO.SUGERIDA.proposta);
      expect(movida.avisos).toEqual([
        {
          codigo: AVISOS_OPORTUNIDADE.PROBABILIDADE_REDEFINIDA,
          campo: 'probabilidadeFechamento',
          anterior: OVERRIDE,
        },
      ]);
    });

    it('status e probabilidade juntos: vale a mandada, sem aviso', async () => {
      const { oportunidade } = await oportunidadeComOverride();
      const movida = await ok(
        chamar('PATCH', `/crm/oportunidades/${oportunidade.id}/status`, {
          status: 'proposta',
          probabilidadeFechamento: MANDADA,
        }),
      );
      expect(movida.probabilidadeFechamento).toBe(MANDADA);
      expect(movida.avisos).toEqual([]);
    });

    it('editar o status pela tabela (PUT do lead) também limpa e avisa', async () => {
      const { leadId } = await oportunidadeComOverride();
      const lead = await ok(chamar('PUT', `/crm/leads/${leadId}`, { status: 'qualificado' }));
      expect(lead.probabilidadeFechamento ?? null).toBeNull();
      expect(lead.avisos).toEqual([expect.objectContaining({ anterior: OVERRIDE })]);

      const semStatus = await ok(chamar('PUT', `/crm/leads/${leadId}`, { cargo: 'Gerente' }));
      expect(semStatus.avisos).toEqual([]);
    });

    it('mover no quadro comercial devolve o aviso; com a probabilidade em `campos`, ela vale', async () => {
      const contexto = { tenantId, userId: donoId, role: 'DONO' };
      const primeira = await oportunidadeComOverride();
      const movida = await provedorComercial.mover(contexto, {
        quadroRef: vendas.id,
        entidadeId: primeira.oportunidade.id,
        colunaDestino: 'proposta',
      });
      expect(movida.avisos).toEqual([expect.objectContaining({ anterior: OVERRIDE })]);

      const segunda = await oportunidadeComOverride();
      const comCampo = await provedorComercial.mover(contexto, {
        quadroRef: vendas.id,
        entidadeId: segunda.oportunidade.id,
        colunaDestino: 'proposta',
        campos: { probabilidadeFechamento: MANDADA },
      });
      expect(comCampo.avisos).toEqual([]);
      const [linha] = await prisma.$queryRaw`
        SELECT probability_override::int AS p FROM modulo_crm.crm_deal
        WHERE id = ${segunda.oportunidade.id}::uuid
      `;
      expect(linha.p).toBe(MANDADA);
    });

    it('quem não vê Probabilidade não recebe o aviso (ele traz o valor anterior)', async () => {
      const campos = await listarConfiguracaoCampos(tenantId);
      const probabilidade = campos.find((c) => c.chave === 'probabilidadeFechamento');
      await ok(
        chamar('PUT', '/crm/configuracoes/permissoes', {
          OPERADOR: { [probabilidade.id]: 'hidden' },
        }),
      );
      const { oportunidade } = await oportunidadeComOverride();
      const movida = await ok(
        chamar(
          'PATCH',
          `/crm/oportunidades/${oportunidade.id}/status`,
          { status: 'proposta' },
          operador,
        ),
      );
      expect(movida.avisos).toEqual([]);
      expect(movida).not.toHaveProperty('probabilidadeEfetiva');
    });
  });
});
