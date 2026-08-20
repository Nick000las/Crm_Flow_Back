/** @typedef {import('#core/types/module.js').TenantContext} TenantContext */

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {TenantContext} ctx
 * @returns {string}
 */
export function signAccessToken(app, ctx) {
  return app.jwt.access.sign(ctx);
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {string} userId
 * @returns {string}
 */
export function signRefreshToken(app, userId) {
  return app.jwt.refresh.sign({ userId });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {string} token
 * @returns {TenantContext}
 */
export function verifyAccessToken(app, token) {
  return /** @type {TenantContext} */ (app.jwt.access.verify(token));
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {string} token
 * @returns {{ userId: string }}
 */
export function verifyRefreshToken(app, token) {
  return /** @type {{ userId: string }} */ (app.jwt.refresh.verify(token));
}
