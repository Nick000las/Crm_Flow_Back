import { z } from 'zod';
import { authenticateHook, requireRole } from '#core/auth/rbac.js';
import { TENANT_STATUS } from '#shared/constants/index.js';
import { provisionarTenant } from '#core/tenant/provisioning.js';
import { TenantManagement } from '#core/tenant/management.js';

const criarTenantBodySchema = z.object({
  nome: z.string().min(1),
  subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/),
  owner: z.object({
    nome: z.string().min(1),
    email: z.string().email(),
    senha: z.string().min(8),
  }),
  modulosContratados: z.array(z.string()).min(1),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const moduleKeyParamSchema = z.object({ id: z.string().uuid(), moduleKey: z.string().min(1) });

// .strict() — rejeita campos desconhecidos no body, ex: status ou subdomain
// enviados por engano aqui. Essas duas mudanças têm rota própria, de propósito.
const atualizarTenantBodySchema = z
  .object({
    nome: z.string().min(1).optional(),
    dominio_customizado: z.string().min(1).optional(),
    tema_json: z.record(z.unknown()).optional(),
    data_region: z.string().min(1).optional(),
    retencao_conversa_meses: z.coerce.number().int().positive().optional(),
  })
  .strict();

const atualizarStatusBodySchema = z.object({
  status: z.enum(Object.values(TENANT_STATUS)),
});

const atualizarModulosBodySchema = z.object({
  modulosContratados: z.array(z.string()).min(1),
});

/**
 * Rotas administrativas de tenant (Bloco 1.1.5) — não são produto de nenhum
 * módulo, por isso moram em api/routes/ e não em modules/.
 *
 * Protegidas igual a qualquer rota normal: authenticateHook (JWT válido) +
 * requireRole(['MASTER']) (RBAC). Presume que quem chama já é um MASTER
 * autenticado — a própria equipe interna logada no tenant da plataforma.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAdminTenantRoutes(app) {
  const protegida = { preHandler: [authenticateHook, requireRole(['MASTER'])] };

  app.post('/admin/tenants', protegida, async (req, reply) => {
    const body = criarTenantBodySchema.parse(req.body);
    const resultado = await provisionarTenant(body);
    return reply.code(201).send(resultado); // nunca ecoa senha/hash
  });

  app.get('/admin/tenants', protegida, async (req, reply) => {
    const tenants = await TenantManagement.listTenants();
    return reply.send(tenants);
  });

  app.get('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const tenant = await TenantManagement.getTenantById(id);
    return reply.send(tenant);
  });

  app.put('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = atualizarTenantBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarTenant(id, body);
    return reply.send(tenant);
  });

  app.put('/admin/tenants/:id/status', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = atualizarStatusBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarStatusTenant(id, status);
    return reply.send(tenant);
  });

  app.put('/admin/tenants/:id/modules', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { modulosContratados } = atualizarModulosBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarModulosTenant(id, modulosContratados);
    return reply.send(tenant);
  });

  app.delete('/admin/tenants/:id/modules/:moduleKey', protegida, async (req, reply) => {
    const { id, moduleKey } = moduleKeyParamSchema.parse(req.params);
    const resultado = await TenantManagement.desligarModuleTenant(id, moduleKey);
    return reply.send(resultado);
  });

  app.delete('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const tenant = await TenantManagement.deleteTenant(id);
    return reply.send(tenant);
  });
}
