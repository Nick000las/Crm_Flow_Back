import fastifyJwt from '@fastify/jwt';

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
    sign: { expiresIn: '15m' },
  });

  app.register(fastifyJwt, {
    namespace: 'refresh',
    secret: config.JWT_REFRESH_SECRET,
    sign: { expiresIn: '7d' },
  });
}
