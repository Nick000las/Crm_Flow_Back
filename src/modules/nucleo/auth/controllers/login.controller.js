import {
  signAccessToken,
  signPasswordActivationToken,
  signRefreshToken,
  verifyPasswordActivationToken,
  verifyRefreshToken,
} from '#core/auth/jwt.js';
import { PASSWORD_ACTIVATION } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendSuccess } from '#shared/http/response.js';
import {
  activatePasswordBodySchema,
  loginBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  verifyCodeBodySchema,
} from '../schemas/login.schema.js';
import { LoginService } from '../services/login.service.js';

const ACTIVATION_COOKIE_NAME = 'activation_token';
const ACTIVATION_COOKIE_PATH = '/auth/activation';

export class LoginController {
  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async verifyUserLoginEmail(request, response) {
    try {
      const { email } = loginBodySchema.parse(request.body);

      const result = await LoginService.identifyEmail({
        email,
        emailConfig: request.server.config,
      });

      return sendSuccess(response, result);
    } catch (error) {
      console.error(error);
      return response.send(error);
    }
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async loginWithPassword(request, response) {
    try {
      const body = passwordLoginBodySchema.parse(request.body);
      const tenantContext = await LoginService.authenticateWithPassword(body);
      return sendSuccess(
        response,
        createAuthTokens(request.server, tenantContext)
      );
    } catch (error) {
      console.error(error);
      return response.send(error);
    }
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async verifyActivationCode(request, response) {
    try {
      const { email, verificationCode } = verifyCodeBodySchema.parse(
        request.body
      );

      const activationContext = await LoginService.verifyActivationCode({
        email,
        verificationCode,
      });
      const activationToken = signPasswordActivationToken(
        request.server,
        activationContext
      );

      response.setCookie(ACTIVATION_COOKIE_NAME, activationToken, {
        httpOnly: true,
        secure: request.server.config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: ACTIVATION_COOKIE_PATH,
        maxAge: PASSWORD_ACTIVATION.TOKEN_EXPIRATION_SECONDS,
      });

      return sendSuccess(response, { nextStep: 'createPassword' });
    } catch (error) {
      console.error(error);
      return response.send(error);
    }
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async activatePassword(request, response) {
    try {
      const { senha } = activatePasswordBodySchema.parse(request.body);
      const activationToken = request.cookies[ACTIVATION_COOKIE_NAME];

      if (!activationToken) {
        throw new AppError({
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          code: ERROR_CODES.AUTH_INVALID_ACTIVATION_TOKEN,
          message: 'Token de ativação inválido ou expirado',
        });
      }

      let payload;
      try {
        payload = verifyPasswordActivationToken(
          request.server,
          activationToken
        );
      } catch {
        throw new AppError({
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          code: ERROR_CODES.AUTH_INVALID_ACTIVATION_TOKEN,
          message: 'Token de ativação inválido ou expirado',
        });
      }

      const tenantContext = await LoginService.activatePassword({
        ...payload,
        senha,
      });

      response.clearCookie(ACTIVATION_COOKIE_NAME, {
        path: ACTIVATION_COOKIE_PATH,
      });

      return sendSuccess(
        response,
        createAuthTokens(request.server, tenantContext)
      );
    } catch (error) {
      console.error(error);
      return response.send(error);
    }
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async refreshAccessToken(request, response) {
    try {
      const { refreshToken } = refreshBodySchema.parse(request.body);

      let payload;
      try {
        payload = verifyRefreshToken(request.server, refreshToken);
      } catch {
        throw new AppError({
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          code: ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN,
          message: 'Refresh token inválido ou expirado',
        });
      }

      const tenantContext = await LoginService.getUserContext({
        userId: payload.userId,
      });
      return sendSuccess(response, {
        accessToken: signAccessToken(request.server, tenantContext),
      });
    } catch (error) {
      console.error(error);
      return response.send(error);
    }
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} response
   */
  static async getAuthenticatedUser(request, response) {
    return sendSuccess(response, { user: request.tenantContext });
  }

  /**
   * Tokens de acesso são stateless; o cliente encerra a sessão descartando-os.
   * @param {import('fastify').FastifyRequest} _request
   * @param {import('fastify').FastifyReply} response
   */
  static async logout(_request, response) {
    return sendSuccess(response, {});
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
