import { z } from 'zod';
import { authenticateHook, requireRole } from '#core/auth/rbac.js';
import { HTTP_STATUS, TENANT_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { provisionarTenant } from '#core/tenant/provisioning.js';
import { TenantManagement } from '#core/tenant/management.js';

const criarTenantBodySchema = z.object({
  nome: z.string().min(1),
  subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/),
  owner: z.object({
    nome: z.string().min(1),
    // e-mail é único globalmente via índice case-insensitive (migration
    // 0003) — normaliza na escrita pra bater com a busca do login (mode:
    // 'insensitive'), mesmo padrão de login.schema.js.
    email: z.string().email().transform((email) => email.toLowerCase()),
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
    dominioCustomizado: z.string().min(1).optional(),
    temaJson: z.record(z.unknown()).optional(),
    dataRegion: z.string().min(1).optional(),
    retencaoConversaMeses: z.coerce.number().int().positive().optional(),
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
 * O owner criado em POST /admin/tenants nasce sem senha (fluxo de convite —
 * ver core/auth/login/services/login.service.js): ele recebe um e-mail com
 * código de ativação na primeira tentativa de login, não define senha aqui.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAdminTenantRoutes(app) {
  const protegida = { preHandler: [authenticateHook, requireRole(['MASTER'])] };

  app.post('/admin/tenants', protegida, async (req, reply) => {
    const body = criarTenantBodySchema.parse(req.body);
    const resultado = await provisionarTenant(body);
    return sendSuccess(reply, resultado, HTTP_STATUS.CREATED);
  });

  app.get('/admin/tenants', protegida, async (req, reply) => {
    const tenants = await TenantManagement.listTenants();
    return sendSuccess(reply, tenants);
  });

  app.get('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const tenant = await TenantManagement.getTenantById(id);
    return sendSuccess(reply, tenant);
  });

  app.put('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = atualizarTenantBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarTenant(id, body);
    return sendSuccess(reply, tenant);
  });

  app.put('/admin/tenants/:id/status', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = atualizarStatusBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarStatusTenant(id, status);
    return sendSuccess(reply, tenant);
  });

  app.put('/admin/tenants/:id/modules', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { modulosContratados } = atualizarModulosBodySchema.parse(req.body);
    const tenant = await TenantManagement.atualizarModulosTenant(id, modulosContratados);
    return sendSuccess(reply, tenant);
  });

  app.delete('/admin/tenants/:id/modules/:moduleKey', protegida, async (req, reply) => {
    const { id, moduleKey } = moduleKeyParamSchema.parse(req.params);
    const resultado = await TenantManagement.desligarModuleTenant(id, moduleKey);
    return sendSuccess(reply, resultado);
  });

  app.delete('/admin/tenants/:id', protegida, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const tenant = await TenantManagement.deleteTenant(id);
    return sendSuccess(reply, tenant);
  });
}
