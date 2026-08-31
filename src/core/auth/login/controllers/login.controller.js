import {
  signAccessToken,
  signLoginMfaToken,
  signPasswordActivationToken,
  signRefreshToken,
  verifyLoginMfaToken,
  verifyPasswordActivationToken,
  verifyRefreshToken,
} from '#core/auth/jwt.js';
import { LOGIN_MFA, PASSWORD_ACTIVATION, REFRESH_SESSION } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS, ROLES } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendSuccess } from '#shared/http/response.js';
import {
  activatePasswordBodySchema,
  loginBodySchema,
  mfaDisableBodySchema,
  mfaVerifyBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  sessionQuerySchema,
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
  getUserSettings as getUserSettingsService,
  getSessionUser,
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
      httpOnly: true,
      secure: request.server.config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: MFA_COOKIE_PATH,
      maxAge: LOGIN_MFA.TOKEN_EXPIRATION_SECONDS,
    });
    return sendSuccess(response, { nextStep: 'mfaCode' });
  }

  return sendAuthTokens(request, response, resultado);
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function verifyActivationCode(request, response) {
  const { email, verificationCode } = verifyCodeBodySchema.parse(request.body);

  const activationContext = await verifyActivationCodeService({
    email,
    verificationCode,
  });
  const activationToken = signPasswordActivationToken(request.server, activationContext);

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

  return sendAuthTokens(request, response, tenantContext);
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
  const data = await disableMfaService({
    userId: request.tenantContext.userId,
    senha,
  });
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
    payload = verifyPasswordActivationToken(request.server, activationToken);
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

  return sendAuthTokens(request, response, tenantContext);
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function refreshAccessToken(request, response) {
  const { refreshToken: refreshDoCorpo, scope } = refreshBodySchema.parse(request.body ?? {});
  // Corpo antes do cookie: a sessão master manda o token no corpo e não pode
  // herdar o cookie de uma sessão de tenant aberta no mesmo navegador.
  const refreshToken = refreshDoCorpo ?? request.cookies[refreshCookieName(scope)];
  const veioDoCookie = refreshDoCorpo === undefined;

  let payload;
  try {
    if (!refreshToken) throw new Error('Sem refresh token');
    payload = verifyRefreshToken(request.server, refreshToken);
  } catch {
    // Cookie vencido ou adulterado não deve ficar sendo reenviado.
    if (veioDoCookie) clearRefreshCookie(response, scope);
    throw new AppError({
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN,
      message: 'Refresh token inválido ou expirado',
    });
  }

  const tenantContext = await getUserContext({
    userId: payload.userId,
  });
  if (veioDoCookie) {
    assertSessionScope(tenantContext, scope);
    setRefreshCookie(request, response, refreshToken, scope);
  }
  return sendSuccess(response, {
    accessToken: signAccessToken(request.server, tenantContext),
  });
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function getAuthenticatedUser(request, response) {
  return sendSuccess(response, { user: await getSessionUser(request.tenantContext) });
}

/** Restaura a sessão pelo cookie ou consulta o usuário do access token. */
export async function getCurrentSession(request, response) {
  return respondWithSession(request, response);
}

/** Bootstrap: ausência de login é estado normal, não uma falha de requisição. */
export async function restoreCurrentSession(request, response) {
  try {
    return await respondWithSession(request, response, { restore: true });
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== HTTP_STATUS.UNAUTHORIZED) {
      throw error;
    }
    const { scope } = sessionQuerySchema.parse(request.query);
    clearRefreshCookie(response, scope);
    return sendSuccess(response, { accessToken: null, user: null });
  }
}

async function respondWithSession(request, response, { restore = false } = {}) {
  const { scope } = sessionQuerySchema.parse(request.query);
  response.header('Cache-Control', 'no-store');
  let context = request.tenantContext;
  if (!context) {
    const token = request.cookies[refreshCookieName(scope)];
    if (!token) {
      if (restore) return sendSuccess(response, { accessToken: null, user: null });
      throw invalidSessionError();
    }
    let payload;
    try {
      payload = verifyRefreshToken(request.server, token);
    } catch {
      clearRefreshCookie(response, scope);
      throw invalidSessionError();
    }
    context = await getUserContext({ userId: payload.userId });
    assertSessionScope(context, scope);
    if (restore) setRefreshCookie(request, response, token, scope);
  } else {
    // Revalida usuário ativo e papel no banco, sem confiar em permissões antigas.
    context = await getUserContext({ userId: context.userId });
  }
  assertSessionScope(context, scope);
  const [sessionUser, settings] = await Promise.all([
    context.tenantId
      ? getSessionUser(context)
      : { ...context, modulosAtivos: [], featuresAtivas: [] },
    getUserSettingsService({ userId: context.userId }),
  ]);
  return sendSuccess(response, {
    accessToken: signAccessToken(request.server, context),
    user: { ...sessionUser, ...settings },
  });
}

function invalidSessionError() {
  return new AppError({
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    code: ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN,
    message: 'Sessão inválida ou expirada',
  });
}

function assertSessionScope(context, scope) {
  if (scope === 'admin' ? context.role !== ROLES.MASTER : !context.tenantId) {
    throw invalidSessionError();
  }
}

/**
 * Consulta as configurações atuais da conta no banco, incluindo MFA.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function getUserSettings(request, response) {
  const data = await getUserSettingsService({
    userId: request.tenantContext.userId,
  });
  return sendSuccess(response, data);
}

/**
 * Descarta o cookie da área autenticada, preservando a outra sessão.
 * Access tokens já emitidos continuam válidos até sua expiração.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 */
export async function logout(request, response) {
  const scope =
    request.body?.scope ?? (request.tenantContext.role === ROLES.MASTER ? 'admin' : 'tenant');
  sessionQuerySchema.parse({ scope });
  assertSessionScope(request.tenantContext, scope);
  clearRefreshCookie(response, scope);
  return sendSuccess(response, {});
}

/**
 * Entrega os tokens de uma sessão recém-aberta.
 *
 * Refresh tokens vão somente em cookies httpOnly distintos por área.
 * Tenant e MASTER sobrevivem ao F5 sem sobrescrever a outra sessão.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} response
 * @param {import('#core/types/module.js').TenantContext} tenantContext
 */
function sendAuthTokens(request, response, tenantContext) {
  const { accessToken, refreshToken } = createAuthTokens(request.server, tenantContext);
  const scope = request.body?.scope ?? (tenantContext.role === ROLES.MASTER ? 'admin' : 'tenant');
  assertSessionScope(tenantContext, scope);
  setRefreshCookie(request, response, refreshToken, scope);
  return sendSuccess(response, { accessToken });
}

function refreshCookieName(scope) {
  return scope === 'admin' ? REFRESH_SESSION.ADMIN_COOKIE_NAME : REFRESH_SESSION.COOKIE_NAME;
}

function setRefreshCookie(request, response, refreshToken, scope) {
  response.setCookie(refreshCookieName(scope), refreshToken, {
    httpOnly: true,
    secure: request.server.config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_SESSION.COOKIE_PATH,
    maxAge: REFRESH_SESSION.TOKEN_EXPIRATION_SECONDS,
  });
  // Remove o cookie antigo para não haver dois tokens com o mesmo nome.
  response.clearCookie(refreshCookieName(scope), { path: REFRESH_SESSION.LEGACY_COOKIE_PATH });
}

/** @param {import('fastify').FastifyReply} response */
function clearRefreshCookie(response, scope = 'tenant') {
  for (const path of [REFRESH_SESSION.COOKIE_PATH, REFRESH_SESSION.LEGACY_COOKIE_PATH]) {
    response.clearCookie(refreshCookieName(scope), { path });
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
