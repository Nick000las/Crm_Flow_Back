import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getTenantClient, getAdminClient } from '#core/db/tenantClient.js';

/** BLOQUEADOR DE MERGE (Bloco 2.1). Tenta ativamente vazar dado entre dois tenants de teste. */

const prisma = getAdminClient();
const tenantA = randomUUID();
const tenantB = randomUUID();

beforeAll(async () => {
  await prisma.tenant.createMany({
    data: [
      { id: tenantA, nome: 'Tenant Teste A', subdomain: `teste-a-${tenantA.slice(0, 8)}` },
      { id: tenantB, nome: 'Tenant Teste B', subdomain: `teste-b-${tenantB.slice(0, 8)}` },
    ],
  });
  await getTenantClient(tenantA, (tx) =>
    tx.usuario.create({ data: { tenantId: tenantA, nome: 'A', email: 'a@teste.com', senhaHash: 'x' } }),
  );
  await getTenantClient(tenantB, (tx) =>
    tx.usuario.create({ data: { tenantId: tenantB, nome: 'B', email: 'b@teste.com', senhaHash: 'x' } }),
  );
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
});

describe('Isolamento de dados entre tenants (tentativa ativa de vazamento)', () => {
  it('contexto do tenant A NUNCA deve enxergar usuário do tenant B', async () => {
    const resultado = await getTenantClient(tenantA, (tx) => tx.$queryRaw`SELECT id FROM usuarios`);
    const usuarioB = await prisma.usuario.findFirst({ where: { tenantId: tenantB } });
    expect(resultado.map((r) => r.id)).not.toContain(usuarioB?.id);
  });

  it('acessar dado de B por ID direto, com contexto A, deve retornar vazio', async () => {
    const usuarioB = await prisma.usuario.findFirstOrThrow({ where: { tenantId: tenantB } });
    const resultado = await getTenantClient(
      tenantA,
      (tx) => tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuarioB.id}::uuid`,
    );
    expect(resultado).toHaveLength(0);
  });
});
