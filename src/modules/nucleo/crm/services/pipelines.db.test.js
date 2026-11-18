import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { buscarDiasPorStatus } from '../adapters/crm-inatividade.repository.js';
import { buscarOpcoesDoTenant, inserirOpcoes } from '../adapters/crm-options.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import { PIPELINES, TIPOS_LISTA, TIPOS_PIPELINE } from '../constants.js';
import { criarPipeline } from './pipelines.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Pipelines por tenant (M2.5, F2) contra o Postgres: o seed, o limite e,
 * principalmente, que os status do Atendimento não vazem para o lead.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 60_000;
const TAMANHO_SUFIXO = 8;
const STATUS_DE_VENDAS = 'novo';
const POSICAO_NOVA = 9;

rodar('pipelines por tenant (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();

  const opcoesDeStatus = async () =>
    (await buscarOpcoesDoTenant(tenantId)).filter((opcao) => opcao.kind === TIPOS_LISTA.STATUS);

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE pipelines',
        subdomain: `smoke-pipelines-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });

    await reconciliarTenant(tenantId);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await encerrarCache();
  });

  it('tenant novo nasce com Vendas (padrão) e Atendimento', async () => {
    const [vendas, atendimento, ...resto] = await buscarPipelines(tenantId);

    expect(resto).toEqual([]);

    expect(vendas).toMatchObject({
      nome: PIPELINES.NOME_VENDAS,
      tipo: TIPOS_PIPELINE.VENDAS,
      padrao: true,
    });

    expect(atendimento).toMatchObject({
      nome: PIPELINES.NOME_ATENDIMENTO,
      tipo: TIPOS_PIPELINE.ATENDIMENTO,
      padrao: false,
    });

    const [config] = await prisma.$queryRaw`
      SELECT auto_create_enabled, auto_create_from_pipeline_id::text AS origem,
             auto_create_initial_status FROM modulo_crm.crm_pipeline
      WHERE id = ${atendimento.id}::uuid
    `;

    expect(config).toEqual({
      auto_create_enabled: true,
      origem: vendas.id,
      auto_create_initial_status: 'aguardando',
    });
  });

  it('rodar o reconcile de novo não duplica nada', async () => {
    const contar = () => prisma.$queryRaw`
      SELECT (SELECT count(*) FROM modulo_crm.crm_pipeline WHERE tenant_id = ${tenantId}::uuid)::int
               AS pipelines,
             (SELECT count(*) FROM modulo_crm.crm_option WHERE tenant_id = ${tenantId}::uuid)::int
               AS opcoes
    `;
    const antes = await contar();

    await reconciliarTenant(tenantId);
    await expect(contar()).resolves.toEqual(antes);
  });

  it('o lead só enxerga os status de Vendas', async () => {
    const chaves = (await opcoesDeStatus()).map((opcao) => opcao.key);

    expect(chaves).toContain(STATUS_DE_VENDAS);
    expect(chaves).not.toContain('aguardando');

    const dias = (await buscarDiasPorStatus(tenantId)).map((status) => status.key);

    expect(dias).toEqual(chaves);
  });

  it('a mesma chave pode existir em outro pipeline, sem misturar as listas', async () => {
    const atendimento = (await buscarPipelines(tenantId)).find(
      (pipeline) => pipeline.tipo === TIPOS_PIPELINE.ATENDIMENTO,
    );
    const antes = await opcoesDeStatus();

    const [criada] = await inserirOpcoes(
      tenantId,
      TIPOS_LISTA.STATUS,
      [
        {
          key: STATUS_DE_VENDAS,
          label: 'Novo atendimento',
          category: 'aberto',
          position: POSICAO_NOVA,
        },
      ],
      atendimento.id,
    );

    expect(criada.key).toBe(STATUS_DE_VENDAS);
    await expect(opcoesDeStatus()).resolves.toEqual(antes);
  });

  it('a mesma chave não repete no mesmo pipeline', async () => {
    const criadas = await inserirOpcoes(tenantId, TIPOS_LISTA.STATUS, [
      { key: STATUS_DE_VENDAS, label: 'Repetido', category: 'aberto', position: POSICAO_NOVA },
    ]);

    expect(criadas).toEqual([]);
  });

  it('limite de 5: pedidos simultâneos não passam juntos', async () => {
    const criar = () => criarPipeline(tenantId, { nome: 'Extra', tipo: TIPOS_PIPELINE.VENDAS });
    const tentativas = Array.from({ length: PIPELINES.LIMITE_POR_TENANT }, criar);

    const resultados = await Promise.allSettled(tentativas);

    expect(await buscarPipelines(tenantId)).toHaveLength(PIPELINES.LIMITE_POR_TENANT);

    const recusados = resultados.filter((resultado) => resultado.status === 'rejected');

    expect(recusados.length).toBeGreaterThan(0);
    expect(recusados[0].reason.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('status sem pipeline é recusado pelo banco', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO modulo_crm.crm_option (tenant_id, kind, key, label, category)
        VALUES (${tenantId}::uuid, 'status', 'solto', 'Solto', 'aberto')
      `,
    ).rejects.toThrow(/chk_crm_option_pipeline/);
  });
});
