/**
 * @file Centraliza o transporte HTTP de auth routes, na área de aplicação, preservando os
 * contratos da API.
 */
import {
  activatePassword,
  disableMfa,
  enableMfa,
  getAuthenticatedUser,
  getCurrentSession,
  getUserSettings,
  loginWithPassword,
  logout,
  refreshAccessToken,
  restoreCurrentSession,
  verifyActivationCode,
  verifyMfaCode,
  verifyUserLoginEmail,
} from '#core/auth/login/controllers/login.controller.js';
import {
  forgotPassword,
  recoverPassword,
} from '#core/auth/login/controllers/password-recovery.controller.js';
import { authenticateHook } from '#core/auth/rbac.js';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuthRoutes(app) {
  app.get('/auth/session', restoreCurrentSession);

  app.get(
    '/me',
    {
      preHandler: async (request, reply) => {
        if (request.headers.authorization) {
          return authenticateHook(request, reply);
        }
      },
    },
    getCurrentSession,
  );

  app.post('/auth/login', verifyUserLoginEmail);

  app.post('/auth/login/password', loginWithPassword);

  app.post('/auth/password/forgot', forgotPassword);
  app.post('/auth/password/reset', recoverPassword);

  app.post('/auth/activation/verify', verifyActivationCode);

  app.post('/auth/activation/password', activatePassword);

  app.post('/auth/mfa/verify', verifyMfaCode);

  app.post('/auth/refresh', refreshAccessToken);

  app.put('/auth/mfa', { preHandler: authenticateHook }, enableMfa);

  app.delete('/auth/mfa', { preHandler: authenticateHook }, disableMfa);

  app.get('/auth/me', { preHandler: authenticateHook }, getAuthenticatedUser);

  app.get('/auth/settings', { preHandler: authenticateHook }, getUserSettings);

  app.post('/auth/logout', { preHandler: authenticateHook }, logout);
}
