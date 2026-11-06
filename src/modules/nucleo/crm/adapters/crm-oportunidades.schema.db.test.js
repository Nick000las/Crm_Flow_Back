import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { usaOportunidades } from './crm-lead-read-model.js';

/**
 * Regras do banco das migrations 0036 e 0037 (M2.5, F1), direto no Postgres,
 * pelo role `app_tenant` quando a regra depende de RLS. Nenhum service usa
 * estas tabelas ainda: é o que garante a etapa ser só aditiva.
 *
 * GRAVA no banco de `DATABASE_URL` (tenants SMOKE, apagados no fim): só roda
 * com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 60_000;
const TAMANHO_SUFIXO = 8;
const VENDIDO_EM = '2026-11-05T12:00:00.000Z';
/** O Prisma não traz o nome do índice único na mensagem, só o código. */
const VIOLA_UNICIDADE = /23505|Unique constraint/;

rodar('schema de pipelines e oportunidades (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const outroTenantId = randomUUID();
  let vendas;
  let pipelineDeOutro;
  let lead;

  async function criarPipeline(tenant, tipo = 'sales') {
    const [{ id }] = await getTenantClient(
      tenant,
      (tx) => tx.$queryRaw`
        INSERT INTO modulo_crm.crm_pipeline (tenant_id, name, type)
        VALUES (${tenant}::uuid, 'Pipeline', ${tipo}) RETURNING id::text
      `,
    );
    return id;
  }

  async function criarLead(tenant, nome = 'Pessoa') {
    const [{ id }] = await prisma.$queryRaw`
      INSERT INTO modulo_crm.leads (tenant_id, nome, email)
      VALUES (${tenant}::uuid, ${nome}, ${`${randomUUID()}@smoke.test`}) RETURNING id::text
    `;
    return id;
  }

  /** @param {{ pipeline?: string, pessoa?: string, tenant?: string, categoria?: string, ganhaEm?: string | null, origem?: string | null }} [dados] */
  async function criarDeal({
    tenant = tenantId,
    pipeline = vendas,
    pessoa = lead,
    categoria = 'aberto',
    ganhaEm = null,
    origem = null,
  } = {}) {
    const [{ id }] = await getTenantClient(
      tenant,
      (tx) => tx.$queryRaw`
        INSERT INTO modulo_crm.crm_deal
          (tenant_id, lead_id, pipeline_id, source_deal_id, status, status_category, won_at)
        VALUES (${tenant}::uuid, ${pessoa}::uuid, ${pipeline}::uuid, ${origem}::uuid, 'novo',
                ${categoria}, ${ganhaEm}::timestamp)
        RETURNING id::text
      `,
    );
    return id;
  }

  beforeAll(async () => {
    await prisma.tenant.createMany({
      data: [tenantId, outroTenantId].map((id) => ({
        id,
        nome: `SMOKE oportunidades ${id}`,
        subdomain: `smoke-oport-${id.slice(0, TAMANHO_SUFIXO)}`,
      })),
    });
    vendas = await criarPipeline(tenantId);
    pipelineDeOutro = await criarPipeline(outroTenantId);
    lead = await criarLead(tenantId);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, outroTenantId] } } });
    const [{ sobras }] = await prisma.$queryRaw`
      SELECT (SELECT count(*) FROM modulo_crm.crm_deal
              WHERE tenant_id IN (${tenantId}::uuid, ${outroTenantId}::uuid))::int
           + (SELECT count(*) FROM modulo_crm.crm_pipeline
              WHERE tenant_id IN (${tenantId}::uuid, ${outroTenantId}::uuid))::int AS sobras
    `;
    expect(sobras).toBe(0);
  });

  it('a leitura de leads continua no modelo atual', async () => {
    await expect(getTenantClient(tenantId, usaOportunidades)).resolves.toBe(false);
  });

  it('lead novo nasce como "lead", sem oportunidade principal', async () => {
    const [linha] = await prisma.$queryRaw`
      SELECT lifecycle_stage, principal_deal_id FROM modulo_crm.leads WHERE id = ${lead}::uuid
    `;
    expect(linha).toEqual({ lifecycle_stage: 'lead', principal_deal_id: null });
  });

  it('oportunidade: ganho exige data, e a data exige ganho', async () => {
    await expect(criarDeal({ categoria: 'ganho' })).rejects.toThrow(/chk_crm_deal_datas/);
    await expect(criarDeal({ categoria: 'aberto', ganhaEm: VENDIDO_EM })).rejects.toThrow(
      /chk_crm_deal_datas/,
    );
    await expect(criarDeal({ categoria: 'ganho', ganhaEm: VENDIDO_EM })).resolves.toEqual(
      expect.any(String),
    );
  });

  it('não aponta para pessoa ou pipeline de outra empresa', async () => {
    await expect(criarDeal({ pipeline: pipelineDeOutro })).rejects.toThrow(/fk_crm_deal_pipeline/);
    const pessoaDeOutro = await criarLead(outroTenantId);
    await expect(criarDeal({ pessoa: pessoaDeOutro })).rejects.toThrow(/fk_crm_deal_lead/);
  });

  it('RLS: uma empresa não enxerga nem grava pela outra', async () => {
    await criarDeal();
    const contar = (tenant) =>
      getTenantClient(
        tenant,
        (tx) => tx.$queryRaw`
          SELECT (SELECT count(*) FROM modulo_crm.crm_deal)::int AS oportunidades,
                 (SELECT count(*) FROM modulo_crm.crm_pipeline)::int AS pipelines
        `,
      );
    const [deOutro] = await contar(outroTenantId);
    expect(deOutro.oportunidades).toBe(0);
    expect(deOutro.pipelines).toBe(1);

    await expect(
      getTenantClient(
        outroTenantId,
        (tx) => tx.$executeRaw`
          INSERT INTO modulo_crm.crm_pipeline (tenant_id, name, type)
          VALUES (${tenantId}::uuid, 'Invasão', 'sales')
        `,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('um atendimento por venda: repetir o ganho não duplica', async () => {
    const atendimento = await criarPipeline(tenantId, 'service');
    const venda = await criarDeal({ categoria: 'ganho', ganhaEm: VENDIDO_EM });

    await criarDeal({ pipeline: atendimento, origem: venda });

    await expect(criarDeal({ pipeline: atendimento, origem: venda })).rejects.toThrow(
      VIOLA_UNICIDADE,
    );
  });

  it('pipeline: só `service` nasce sozinho, e só um padrão por empresa', async () => {
    const inserir = (tipo, { padrao = false, automatico = false } = {}) =>
      prisma.$executeRaw`
        INSERT INTO modulo_crm.crm_pipeline
          (tenant_id, name, type, is_default, auto_create_enabled)
        VALUES (${tenantId}::uuid, 'Regra', ${tipo}, ${padrao}, ${automatico})
      `;
    await expect(inserir('sales', { automatico: true })).rejects.toThrow(
      /chk_crm_pipeline_auto_criacao/,
    );
    await expect(inserir('service', { padrao: true })).rejects.toThrow(/chk_crm_pipeline_padrao/);
    await inserir('sales', { padrao: true });
    await expect(inserir('sales', { padrao: true })).rejects.toThrow(VIOLA_UNICIDADE);
  });

  it('apagar a pessoa leva as oportunidades e limpa a principal', async () => {
    const pessoa = await criarLead(tenantId, 'Purga');
    const deal = await criarDeal({ pessoa });
    await prisma.$executeRaw`
      UPDATE modulo_crm.leads SET principal_deal_id = ${deal}::uuid WHERE id = ${pessoa}::uuid
    `;

    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE id = ${pessoa}::uuid`;

    const linhas = await prisma.$queryRaw`
      SELECT id FROM modulo_crm.crm_deal WHERE id = ${deal}::uuid
    `;
    expect(linhas).toEqual([]);
  });

  describe('outbox', () => {
    async function criarEvento() {
      const [{ id }] = await getTenantClient(
        tenantId,
        (tx) => tx.$queryRaw`
          INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload)
          VALUES (${tenantId}::uuid, 'deal.created', 'deal', ${randomUUID()}::uuid, '{}'::jsonb)
          RETURNING id::text
        `,
      );
      return id;
    }

    it('só o controle de processamento muda', async () => {
      const id = await criarEvento();
      const atualizar = (sql) => getTenantClient(tenantId, sql);

      await expect(
        atualizar(
          (tx) => tx.$executeRaw`
            UPDATE modulo_crm.crm_event SET processed_at = now(), attempts = 1
            WHERE id = ${id}::uuid
          `,
        ),
      ).resolves.toBe(1);
      await expect(
        atualizar(
          (tx) => tx.$executeRaw`
            UPDATE modulo_crm.crm_event SET tipo = 'outro' WHERE id = ${id}::uuid
          `,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('o tenant não apaga evento', async () => {
      const id = await criarEvento();
      await expect(
        getTenantClient(
          tenantId,
          (tx) => tx.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE id = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
