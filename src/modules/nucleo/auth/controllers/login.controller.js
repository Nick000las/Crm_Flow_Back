import {
  signAccessToken,
  signPasswordActivationToken,
  signRefreshToken,
  verifyPasswordActivationToken,
  verifyRefreshToken,
} from '#core/auth/jwt.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import {
  activatePasswordBodySchema,
  loginBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  verifyCodeBodySchema,
} from '../schemas/login.schema.js';
import { LoginService } from '../services/login.service.js';

export class LoginController {
  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async verifyUserLoginEmail(request, response) {
    const { email } = loginBodySchema.parse(request.body);

    const result = await LoginService.identifyEmail({
      email,
      emailConfig: request.server.config,
    });

    console.log({ result });

    return sendSuccess(response, result);
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async loginWithPassword(request, response) {
    const body = passwordLoginBodySchema.parse(request.body);
    const tenantContext = await LoginService.authenticateWithPassword(body);
    return sendSuccess(
      response,
      createAuthTokens(request.server, tenantContext)
    );
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async verifyActivationCode(request, response) {
    const result = await LoginService.verifyActivationCode(
      verifyCodeBodySchema.parse(request.body)
    );
    return sendSuccess(response, {
      activationToken: signPasswordActivationToken(request.server, result),
    });
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async activatePassword(request, response) {
    const { activationToken, senha } = activatePasswordBodySchema.parse(
      request.body
    );

    let payload;
    try {
      payload = verifyPasswordActivationToken(request.server, activationToken);
    } catch {
      throw Object.assign(new Error('Token de ativação inválido ou expirado'), {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
      });
    }

    const tenantContext = await LoginService.activatePassword({
      ...payload,
      senha,
    });
    return sendSuccess(
      response,
      createAuthTokens(request.server, tenantContext)
    );
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async refreshAccessToken(request, response) {
    const { refreshToken } = refreshBodySchema.parse(request.body);

    let payload;
    try {
      payload = verifyRefreshToken(request.server, refreshToken);
    } catch {
      throw Object.assign(new Error('Refresh token inválido ou expirado'), {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
      });
    }

    const tenantContext = await LoginService.getUserContext({
      userId: payload.userId,
    });
    return sendSuccess(response, {
      accessToken: signAccessToken(request.server, tenantContext),
    });
  }
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {import('#core/types/module.js').TenantContext} tenantContext
 */
function createAuthTokens(app, tenantContext) {
  return {
    accessToken: signAccessToken(app, tenantContext),
    refreshToken: signRefreshToken(app, tenantContext.userId),
  };
}
