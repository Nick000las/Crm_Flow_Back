import {
  activatePassword,
  disableMfa,
  enableMfa,
  getAuthenticatedUser,
  loginWithPassword,
  logout,
  refreshAccessToken,
  verifyActivationCode,
  verifyMfaCode,
  verifyUserLoginEmail,
} from '#core/auth/login/controllers/login.controller.js';
import { authenticateHook } from '#core/auth/rbac.js';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuthRoutes(app) {
  app.post('/auth/login', verifyUserLoginEmail);

  app.post('/auth/login/password', loginWithPassword);

  app.post('/auth/activation/verify', verifyActivationCode);

  app.post('/auth/activation/password', activatePassword);

  app.post('/auth/mfa/verify', verifyMfaCode);

  app.post('/auth/refresh', refreshAccessToken);

  app.put(
    '/auth/mfa',
    { preHandler: authenticateHook },
    enableMfa
  );

  app.delete(
    '/auth/mfa',
    { preHandler: authenticateHook },
    disableMfa
  );

  app.get(
    '/auth/me',
    { preHandler: authenticateHook },
    getAuthenticatedUser
  );

  app.post(
    '/auth/logout',
    { preHandler: authenticateHook },
    logout
  );
}
