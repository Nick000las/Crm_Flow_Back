import { LoginController } from '#modules/nucleo/auth/controllers/login.controller.js';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuthRoutes(app) {
  app.post('/auth/login', LoginController.verifyUserLoginEmail);

  app.post('/auth/login/password', LoginController.loginWithPassword);

  app.post('/auth/activation/verify', LoginController.verifyActivationCode);

  app.post('/auth/activation/password', LoginController.activatePassword);

  app.post('/auth/refresh', LoginController.refreshAccessToken);
}
