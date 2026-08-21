import { JWT_EXPIRATION } from '#core/auth/constants.js';

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
  return app.jwt.refresh.sign({ userId, purpose: 'refresh' });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ userId: string, activationCodeId: string }} input
 */
export function signPasswordActivationToken(app, input) {
  return app.jwt.access.sign(
    { ...input, purpose: 'password-activation' },
    { expiresIn: JWT_EXPIRATION.PASSWORD_ACTIVATION_TOKEN },
  );
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
  const payload = /** @type {{ userId?: string, purpose?: string }} */ (
    app.jwt.refresh.verify(token)
  );
  if (payload.purpose !== 'refresh' || typeof payload.userId !== 'string') {
    throw new Error('Refresh token inválido');
  }
  return /** @type {{ userId: string }} */ (payload);
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {string} token
 */
export function verifyPasswordActivationToken(app, token) {
  const payload = /** @type {{
   *   userId?: string,
   *   activationCodeId?: string,
   *   purpose?: string,
   * }} */ (app.jwt.access.verify(token));

  if (
    payload.purpose !== 'password-activation' ||
    typeof payload.userId !== 'string' ||
    typeof payload.activationCodeId !== 'string'
  ) {
    throw new Error('Token de ativação inválido');
  }

  return /** @type {{ userId: string, activationCodeId: string }} */ (payload);
}
