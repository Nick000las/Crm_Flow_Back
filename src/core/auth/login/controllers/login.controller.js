import {
  signAccessToken,
  signLoginMfaToken,
  signPasswordActivationToken,
  signRefreshToken,
  verifyLoginMfaToken,
  verifyPasswordActivationToken,
  verifyRefreshToken,
} from '#core/auth/jwt.js';
import { LOGIN_MFA, PASSWORD_ACTIVATION } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendSuccess } from '#shared/http/response.js';
import {
  activatePasswordBodySchema,
  loginBodySchema,
  mfaDisableBodySchema,
  mfaVerifyBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  verifyCodeBodySchema,
} from '../schemas/login.schema.js';
import {
  identifyEmail,
  authenticateWithPassword,
  verifyActivationCode as verifyActivationCodeService,
  verifyLoginMfaCode,
  activatePassword as activatePasswordService,
  enableMfa as enableMfaService,
  disableMfa as disableMfaService,
  getUserContext,
} from '../services/login.service.js';

const ACTIVATION_COOKIE_NAME = 'activation_token';
const ACTIVATION_COOKIE_PATH = '/auth/activation';
const MFA_COOKIE_NAME = 'mfa_token';
const MFA_COOKIE_PATH = '/auth/mfa';

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function verifyUserLoginEmail(request, response) {
  const { email } = loginBodySchema.parse(request.body);

  const result = await identifyEmail({
    email,
    emailConfig: request.server.config,
  });

  return sendSuccess(response, result);
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function loginWithPassword(request, response) {
  const body = passwordLoginBodySchema.parse(request.body);
  const resultado = await authenticateWithPassword({
    ...body,
    emailConfig: request.server.config,
  });

  if (resultado.mfaRequired) {
    const mfaToken = signLoginMfaToken(request.server, resultado);
    response.setCookie(MFA_COOKIE_NAME, mfaToken, {
      httpOnly: true, secure: request.server.config.NODE_ENV === 'production', sameSite: 'lax',
      path: MFA_COOKIE_PATH, maxAge: LOGIN_MFA.TOKEN_EXPIRATION_SECONDS,
    });
    return sendSuccess(response, { nextStep: 'mfaCode' });
  }

  return sendSuccess(response, createAuthTokens(request.server, resultado));
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function verifyActivationCode(request, response) {
  const { email, verificationCode } = verifyCodeBodySchema.parse(
    request.body
  );

  const activationContext = await verifyActivationCodeService({
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
}

/**
 * Consome o cookie pendente que `loginWithPassword` seta quando MFA está
 * ativo — nada de e-mail no body, o token já prova que a senha foi
 * validada antes; ele carrega userId/mfaCodeId.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function verifyMfaCode(request, response) {
  const { verificationCode } = mfaVerifyBodySchema.parse(request.body);
  const mfaToken = request.cookies[MFA_COOKIE_NAME];

  if (!mfaToken) {
    throw new AppError({
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.AUTH_INVALID_MFA_TOKEN,
      message: 'Sessão de verificação inválida ou expirada',
    });
  }

  let payload;
  try {
    payload = verifyLoginMfaToken(request.server, mfaToken);
  } catch {
    throw new AppError({
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.AUTH_INVALID_MFA_TOKEN,
      message: 'Sessão de verificação inválida ou expirada',
    });
  }

  const tenantContext = await verifyLoginMfaCode({
    ...payload,
    verificationCode,
  });

  response.clearCookie(MFA_COOKIE_NAME, { path: MFA_COOKIE_PATH });

  return sendSuccess(response, createAuthTokens(request.server, tenantContext));
}

/**
 * Liga MFA — usuário já autenticado (authenticateHook), sem fricção extra:
 * aumentar segurança não exige confirmação, diferente de desligar.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function enableMfa(request, response) {
  const data = await enableMfaService({ userId: request.tenantContext.userId });
  return sendSuccess(response, data);
}

/**
 * Desliga MFA — exige senha no body: só quem prova ser dono da conta pode
 * reduzir a proteção, não só quem tem um access token roubado.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function disableMfa(request, response) {
  const { senha } = mfaDisableBodySchema.parse(request.body);
  const data = await disableMfaService({ userId: request.tenantContext.userId, senha });
  return sendSuccess(response, data);
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function activatePassword(request, response) {
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

  const tenantContext = await activatePasswordService({
    ...payload,
    senha,
  });

  response.clearCookie(ACTIVATION_COOKIE_NAME, {
    path: ACTIVATION_COOKIE_PATH,
  });

  return sendSuccess(response, createAuthTokens(request.server, tenantContext));
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function refreshAccessToken(request, response) {
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

  const tenantContext = await getUserContext({
    userId: payload.userId,
  });
  return sendSuccess(response, {
    accessToken: signAccessToken(request.server, tenantContext),
  });
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function getAuthenticatedUser(request, response) {
  return sendSuccess(response, { user: request.tenantContext });
}

/**
 * Tokens de acesso são stateless; o cliente encerra a sessão descartando-os.
 * @param {import('fastify').FastifyRequest} _request
 * @param {import('fastify').FastifyReply} response
 */
export async function logout(_request, response) {
  return sendSuccess(response, {});
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
