import fastifyJwt from '@fastify/jwt';
import { JWT_EXPIRATION } from '#core/auth/constants.js';

/**
 * Registra validadores separados para access e refresh tokens.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ JWT_SECRET: string, JWT_REFRESH_SECRET: string }} config
 */
export function registerJwt(app, config) {
  app.register(fastifyJwt, {
    namespace: 'access',
    secret: config.JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRATION.ACCESS_TOKEN },
  });

  app.register(fastifyJwt, {
    namespace: 'refresh',
    secret: config.JWT_REFRESH_SECRET,
    sign: { expiresIn: JWT_EXPIRATION.REFRESH_TOKEN },
  });
}
