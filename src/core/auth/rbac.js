/**
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {import('#core/types/module.js').Role} Role
 */

/**
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
export async function authenticateHook(req, reply) {
  try {
    const payload = await req.accessJwtVerify();
    if (!isTenantContext(payload)) throw new Error('Payload JWT inválido');
    req.tenantContext = payload;
  } catch {
    return reply.code(401).send({ error: 'Token inválido ou expirado' });
  }
}

/** @param {unknown} payload */
function isTenantContext(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const value = /** @type {Partial<TenantContext>} */ (payload);
  return (
    typeof value.tenantId === 'string' &&
    typeof value.userId === 'string' &&
    ['MASTER', 'DONO', 'OPERADOR'].includes(value.role ?? '')
  );
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
