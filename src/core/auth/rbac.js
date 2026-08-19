import { verifyAccessToken } from '#core/auth/jwt.js';

/**
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {import('#core/types/module.js').Role} Role
 */

/**
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
export async function authenticateHook(req, reply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Token ausente' });
  }
  try {
    req.tenantContext = verifyAccessToken(authHeader.slice('Bearer '.length));
  } catch {
    return reply.code(401).send({ error: 'Token inválido ou expirado' });
  }
}

/**
 * RBAC governa ação humana direta (Bloco 8.1) — diferente do Human-in-the-Loop (Bloco 6.2).
 * @param {Role[]} allowedRoles
 */
export function requireRole(allowedRoles) {
  /**
   * @param {import('fastify').FastifyRequest} req
   * @param {import('fastify').FastifyReply} reply
   */
  return async (req, reply) => {
    const ctx = req.tenantContext;
    if (!ctx || !allowedRoles.includes(ctx.role)) {
      return reply.code(403).send({ error: 'Permissão insuficiente para esta ação' });
    }
  };
}
