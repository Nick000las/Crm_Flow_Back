import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

import { alterarOportunidade } from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import { CRM_FEATURES, EVENTOS_OPORTUNIDADE, MODULO_CRM, TIPOS_PIPELINE } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from './configuracoes-campos.service.js';
import { registrarNovoLead } from './leads.service.js';
import { anonimizarLeadDoTitular } from './lgpd.service.js';
import {
  criarOportunidade,
  definirArquivamentoDaOportunidade,
  definirLixeiraDaOportunidade,
  editarOportunidade,
  listarOportunidadesDaPessoa,
  mudarStatusDaOportunidade,
} from './oportunidades.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * O service único de oportunidade (M2.5, F3) contra o Postgres: as regras e,
 * principalmente, que oportunidade, pessoa, histórico e outbox entram juntos.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const VALOR = 1500;
const DOIS_PEDIDOS = 2;
const CANCELADO = 'cancelado';

rodar('service único de oportunidade (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let vendas;
  let atendimento;

  /** Pessoa sem oportunidade: estes testes montam cada uma à mão. */
  const novaPessoa = async (nome = 'Pessoa') => {
    const { id } = await registrarNovoLead(
      tenantId,
      { nome, email: `${randomUUID()}@smoke.test` },
      donoId,
    );

    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE lead_id = ${id}::uuid`;

    await prisma.$executeRaw`
      UPDATE modulo_crm.leads SET lifecycle_stage = 'lead' WHERE id = ${id}::uuid
    `;

    return id;
  };

  /** @param {string} id */
  const lerPessoa = async (id) => {
    const [linha] = await prisma.$queryRaw`
      SELECT nome, lifecycle_stage, principal_deal_id::text, ultima_interacao_em
      FROM modulo_crm.leads WHERE id = ${id}::uuid
    `;

    return linha;
  };
  /** @param {string} id */
  const eventosDe = (id) => prisma.$queryRaw`
    SELECT tipo, payload FROM modulo_crm.crm_event
    WHERE tenant_id = ${tenantId}::uuid AND entidade_id = ${id}::uuid ORDER BY occurred_at
  `;
  /** @param {string} leadId */
  const atendimentosDe = async (leadId) =>
    (await listarOportunidadesDaPessoa(tenantId, leadId)).filter(
      (deal) => deal.pipelineId === atendimento.id,
    );
  const perder = (id, extras = {}) =>
    mudarStatusDaOportunidade(tenantId, id, { status: 'perdido', ...extras }, donoId);
  const ganhar = (id) => mudarStatusDaOportunidade(tenantId, id, { status: 'ganho' }, donoId);

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE oportunidades service',
        subdomain: `smoke-opsvc-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: donoId,
        tenantId,
        nome: 'Dono',
        email: `${donoId}@smoke.test`,
        senhaHash: 'test',
        role: 'DONO',
      },
    });

    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });

    await prisma.tenantModuleFeature.createMany({
      data: [CRM_FEATURES.REGRAS, CRM_FEATURES.LGPD].map((featureKey) => ({
        tenantId,
        moduleKey: MODULO_CRM,
        featureKey,
      })),
    });

    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    // A regra "Perdido exige Motivo" só vale com o campo ligado.
    const campos = await listarConfiguracaoCampos(tenantId);

    await atualizarConfiguracaoCampo(
      tenantId,
      campos.find((campo) => campo.chave === 'motivoPerda').id,
      { visibilidade: { create_form: true, detail: true, table: true, filter: true } },
    );

    const pipelines = await buscarPipelines(tenantId);

    vendas = pipelines.find((pipeline) => pipeline.padrao);
    atendimento = pipelines.find((pipeline) => pipeline.tipo === TIPOS_PIPELINE.ATENDIMENTO);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_deal WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await encerrarCache();
  });

  describe('criar', () => {
    it('sem pipeline nem status: Vendas, no primeiro aberto, e a pessoa acompanha', async () => {
      const leadId = await novaPessoa();

      const deal = await criarOportunidade(tenantId, leadId, { valor: VALOR }, donoId);

      expect(deal).toMatchObject({
        pipelineId: vendas.id,
        categoria: 'aberto',
        valor: VALOR,
        responsavelId: donoId,
      });

      expect(await lerPessoa(leadId)).toMatchObject({
        lifecycle_stage: 'oportunidade',
        principal_deal_id: deal.id,
      });

      expect((await eventosDe(deal.id)).map((evento) => evento.tipo)).toEqual([
        EVENTOS_OPORTUNIDADE.CRIADA,
      ]);
    });

    it('uma pessoa tem N oportunidades, cada uma com o status do seu pipeline', async () => {
      const leadId = await novaPessoa();

      await criarOportunidade(tenantId, leadId, {}, donoId);

      await criarOportunidade(
        tenantId,
        leadId,
        { pipelineId: atendimento.id, status: 'em_atendimento' },
        donoId,
      );

      const deals = await listarOportunidadesDaPessoa(tenantId, leadId);

      expect(new Set(deals.map((deal) => deal.pipelineId)).size).toBe(DOIS_PEDIDOS);
      expect(deals.map((deal) => deal.status)).toContain('em_atendimento');
    });

    it('status de outro pipeline é recusado', async () => {
      await expect(
        criarOportunidade(tenantId, await novaPessoa(), { status: 'em_atendimento' }, donoId),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    });

    it('pessoa que não existe é 404', async () => {
      await expect(criarOportunidade(tenantId, randomUUID(), {}, donoId)).rejects.toMatchObject({
        statusCode: HTTP_STATUS.NOT_FOUND,
      });
    });
  });

  describe('mudar status', () => {
    it('Perdido sem motivo: CAMPOS_OBRIGATORIOS e nada muda', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await expect(perder(deal.id)).rejects.toMatchObject({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.CAMPOS_OBRIGATORIOS,
        fields: { motivoPerda: [expect.any(String)] },
      });

      const [atual] = await listarOportunidadesDaPessoa(tenantId, deal.leadId);

      expect(atual.status).toBe(deal.status);
      expect(await eventosDe(deal.id)).toHaveLength(1);
    });

    it('a regra vale pela categoria do pipeline certo, também em Atendimento', async () => {
      const deal = await criarOportunidade(
        tenantId,
        await novaPessoa(),
        { pipelineId: atendimento.id },
        donoId,
      );

      await expect(
        mudarStatusDaOportunidade(tenantId, deal.id, { status: CANCELADO }, donoId),
      ).rejects.toMatchObject({ code: ERROR_CODES.CAMPOS_OBRIGATORIOS });
    });

    it('Perdido com motivo: grava, e a pessoa volta a ser lead', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      const depois = await perder(deal.id, { motivoPerda: 'preco' });

      expect(depois).toMatchObject({ categoria: 'perdido', motivoPerda: 'preco' });
      expect(depois.perdidaEm).not.toBeNull();
      expect((await lerPessoa(deal.leadId)).lifecycle_stage).toBe('lead');
    });

    it('mudar status conta como interação; editar valor, não', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);
      const antes = (await lerPessoa(deal.leadId)).ultima_interacao_em;

      await editarOportunidade(tenantId, deal.id, { valor: VALOR }, donoId);
      expect((await lerPessoa(deal.leadId)).ultima_interacao_em).toEqual(antes);

      await mudarStatusDaOportunidade(tenantId, deal.id, { status: 'proposta' }, donoId);
      expect((await lerPessoa(deal.leadId)).ultima_interacao_em).not.toEqual(antes);
    });

    it('mover com versão antiga: a última vence, com aviso', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await editarOportunidade(tenantId, deal.id, { valor: VALOR }, donoId);

      const depois = await mudarStatusDaOportunidade(
        tenantId,
        deal.id,
        { status: 'proposta', expectedUpdatedAt: deal.atualizadaEm.toISOString() },
        donoId,
      );

      expect(depois).toMatchObject({ status: 'proposta', conflito: true });
    });

    it('editar com versão antiga: 409 e nada muda', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await editarOportunidade(tenantId, deal.id, { valor: VALOR }, donoId);

      await expect(
        editarOportunidade(
          tenantId,
          deal.id,
          { valor: 1, expectedUpdatedAt: deal.atualizadaEm.toISOString() },
          donoId,
        ),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    });
  });

  describe('venda ganha e atendimento', () => {
    it('ganhar cria o atendimento, e a pessoa vira cliente', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await ganhar(deal.id);

      const [card] = await atendimentosDe(deal.leadId);

      expect(card).toMatchObject({
        origemId: deal.id,
        status: 'aguardando',
        responsavelId: donoId,
      });

      expect(await lerPessoa(deal.leadId)).toMatchObject({
        lifecycle_stage: 'cliente',
        principal_deal_id: deal.id,
      });
    });

    it('reabrir marca o atendimento, e ganhar de novo não duplica', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await ganhar(deal.id);

      await mudarStatusDaOportunidade(tenantId, deal.id, { status: 'proposta' }, donoId);

      const [card] = await atendimentosDe(deal.leadId);

      expect(card.origemReabertaEm).not.toBeNull();
      expect((await lerPessoa(deal.leadId)).lifecycle_stage).toBe('oportunidade');

      await ganhar(deal.id);
      expect(await atendimentosDe(deal.leadId)).toHaveLength(1);
    });

    it('dois ganhos ao mesmo tempo geram um atendimento só', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await Promise.all([ganhar(deal.id), ganhar(deal.id)]);

      expect(await atendimentosDe(deal.leadId)).toHaveLength(1);
    });

    it('automação desligada: não cria', async () => {
      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_pipeline SET auto_create_enabled = false
        WHERE id = ${atendimento.id}::uuid
      `;

      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await ganhar(deal.id);

      await expect(atendimentosDe(deal.leadId)).resolves.toEqual([]);

      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_pipeline SET auto_create_enabled = true
        WHERE id = ${atendimento.id}::uuid
      `;
    });
  });

  describe('transação e dado pessoal', () => {
    it('falha no outbox desfaz a oportunidade, a pessoa e o histórico', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);
      const contarHistorico = async () => {
        const [{ total }] = await prisma.$queryRaw`
          SELECT count(*)::int AS total FROM modulo_crm.crm_lead_event
          WHERE lead_id = ${deal.leadId}::uuid
        `;

        return total;
      };
      const pessoaAntes = await lerPessoa(deal.leadId);
      const historicoAntes = await contarHistorico();

      await expect(
        alterarOportunidade(
          tenantId,
          deal.id,
          () => ({ mudancas: { status: 'proposta' }, statusMudou: true, evento: null }),
          { autorId: donoId },
        ),
      ).rejects.toThrow();

      const [atual] = await listarOportunidadesDaPessoa(tenantId, deal.leadId);

      expect(atual.status).toBe(deal.status);
      expect(await lerPessoa(deal.leadId)).toEqual(pessoaAntes);
      expect(await contarHistorico()).toBe(historicoAntes);
    });

    it('evento não carrega dado pessoal', async () => {
      const leadId = await novaPessoa('Nome Muito Pessoal');
      const deal = await criarOportunidade(tenantId, leadId, { titulo: 'Título livre' }, donoId);

      const [evento] = await eventosDe(deal.id);

      expect(JSON.stringify(evento.payload)).not.toMatch(/Nome|Título/);

      expect(evento.payload).toEqual({
        leadId,
        pipelineId: vendas.id,
        status: deal.status,
      });
    });

    it('pessoa anonimizada não muda: 409', async () => {
      const deal = await criarOportunidade(tenantId, await novaPessoa(), {}, donoId);

      await anonimizarLeadDoTitular(tenantId, deal.leadId, donoId);

      await expect(
        mudarStatusDaOportunidade(tenantId, deal.id, { status: 'proposta' }, donoId),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });

      await expect(criarOportunidade(tenantId, deal.leadId, {}, donoId)).rejects.toMatchObject({
        statusCode: HTTP_STATUS.CONFLICT,
      });
    });
  });

  describe('oportunidade principal', () => {
    it('aberta em Vendas ganha da ganha, e a ganha fica se não houver aberta', async () => {
      const leadId = await novaPessoa();
      const ganha = await criarOportunidade(tenantId, leadId, {}, donoId);

      await ganhar(ganha.id);
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(ganha.id);

      const aberta = await criarOportunidade(tenantId, leadId, {}, donoId);

      expect(await lerPessoa(leadId)).toMatchObject({
        principal_deal_id: aberta.id,
        lifecycle_stage: 'cliente',
      });

      await perder(aberta.id, { motivoPerda: 'preco' });
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(ganha.id);
    });

    it('arquivar e excluir tiram da principal; restaurar devolve', async () => {
      const leadId = await novaPessoa();
      const primeira = await criarOportunidade(tenantId, leadId, {}, donoId);
      const segunda = await criarOportunidade(tenantId, leadId, {}, donoId);

      expect((await lerPessoa(leadId)).principal_deal_id).toBe(segunda.id);

      await definirArquivamentoDaOportunidade(tenantId, segunda.id, true, donoId);
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(primeira.id);

      await expect(
        mudarStatusDaOportunidade(tenantId, segunda.id, { status: 'proposta' }, donoId),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });

      await definirArquivamentoDaOportunidade(tenantId, segunda.id, false, donoId);
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(segunda.id);

      await definirLixeiraDaOportunidade(tenantId, segunda.id, true, donoId);
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(primeira.id);

      await expect(
        mudarStatusDaOportunidade(tenantId, segunda.id, { status: 'proposta' }, donoId),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });

      await definirLixeiraDaOportunidade(tenantId, segunda.id, false, donoId);
      expect((await lerPessoa(leadId)).principal_deal_id).toBe(segunda.id);
    });

    it('sem nenhuma oportunidade, a pessoa volta ao início', async () => {
      const leadId = await novaPessoa();
      const deal = await criarOportunidade(tenantId, leadId, {}, donoId);

      await definirLixeiraDaOportunidade(tenantId, deal.id, true, donoId);

      expect(await lerPessoa(leadId)).toMatchObject({
        principal_deal_id: null,
        lifecycle_stage: 'lead',
      });
    });
  });
});
