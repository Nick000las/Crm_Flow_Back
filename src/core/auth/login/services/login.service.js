import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { LOGIN_MFA, PASSWORD_ACTIVATION, PASSWORD_POLICY } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { ROLES_VALIDOS } from '#core/types/module.js';
import { sendLoginMfaCode, sendPasswordActivationCode } from '#core/email/smtp.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  getUserEmailAndPassword,
  runInTransaction,
  getLatestCodigoVerificacao,
  invalidateCodigoVerificacao,
  incrementCodigoVerificacaoAttempts,
  setMfaAtivo,
  getUserById,
} from '../repositories/login.repository.js';

/**
 * @param {{ email: string, emailConfig: Parameters<typeof sendPasswordActivationCode>[0] }} input
 */
export async function identifyEmail({ email, emailConfig }) {
  const usuario = await getUserEmailAndPassword({ email });

  if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVITE_NOT_FOUND,
      'Convite não encontrado para este e-mail'
    );
  }

  if (usuario.senhaHash) {
    return { nextStep: 'password' };
  }

  const now = new Date();
  const code = String(
    randomInt(
      PASSWORD_ACTIVATION.CODE_MIN_VALUE,
      PASSWORD_ACTIVATION.CODE_MAX_VALUE_EXCLUSIVE
    )
  );

  const codigoHash = await bcrypt.hash(
    code,
    PASSWORD_ACTIVATION.CODE_HASH_ROUNDS
  );

  const codigoCriado = await runInTransaction(
    async (repository) => {
      await repository.invalidateUnusedCodigosVerificacao({
        usuarioId: usuario.id,
        proposito: 'ativacao_senha',
        usadoEm: now,
      });

      return repository.createCodigoVerificacao({
        usuarioId: usuario.id,
        tenantId: usuario.tenantId,
        proposito: 'ativacao_senha',
        codigoHash,
        expiraEm: new Date(now.getTime() + PASSWORD_ACTIVATION.EXPIRATION_MS),
      });
    }
  );

  void sendPasswordActivationCode(emailConfig, {
    to: usuario.email,
    code,
  }).catch(async (emailError) => {
    try {
      await invalidateCodigoVerificacao({
        codigoId: codigoCriado.id,
        usuarioId: usuario.id,
        usadoEm: new Date(),
      });
    } catch (cleanupError) {
      console.error(
        new AggregateError(
          [emailError, cleanupError],
          'Falha no envio do e-mail e na invalidação do código'
        )
      );
      return;
    }

    console.error(emailError);
  });

  return { nextStep: 'verificationCode' };
}

/**
 * @param {{ email: string, senha: string, emailConfig: Parameters<typeof sendLoginMfaCode>[0] }} input
 * @returns {Promise<import('#core/types/module.js').TenantContext | { mfaRequired: true, userId: string, mfaCodeId: string }>}
 */
export async function authenticateWithPassword({ email, senha, emailConfig }) {
  const usuario = await getUserEmailAndPassword({ email });
  const senhaValida = usuario?.senhaHash
    ? await bcrypt.compare(senha, usuario.senhaHash)
    : false;

  if (
    !usuario ||
    !usuario.ativo ||
    !senhaValida ||
    !ROLES_VALIDOS.includes(usuario.role)
  ) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'E-mail ou senha inválidos'
    );
  }

  if (usuario.mfaAtivo) {
    return requestLoginMfaCode(usuario, emailConfig);
  }

  return toTenantContext(usuario);
}

/**
 * Gera, salva (hasheado) e envia por e-mail o código de MFA — chamada só
 * depois que a senha já foi validada em `authenticateWithPassword`.
 *
 * @param {{ id: string, tenantId: string, email: string }} usuario
 * @param {Parameters<typeof sendLoginMfaCode>[0]} emailConfig
 */
async function requestLoginMfaCode(usuario, emailConfig) {
  const now = new Date();
  const code = String(
    randomInt(LOGIN_MFA.CODE_MIN_VALUE, LOGIN_MFA.CODE_MAX_VALUE_EXCLUSIVE)
  );
  const codigoHash = await bcrypt.hash(code, LOGIN_MFA.CODE_HASH_ROUNDS);

  const codigoCriado = await runInTransaction(async (repository) => {
    await repository.invalidateUnusedCodigosVerificacao({
      usuarioId: usuario.id,
      proposito: 'login_mfa',
      usadoEm: now,
    });

    return repository.createCodigoVerificacao({
      usuarioId: usuario.id,
      tenantId: usuario.tenantId,
      proposito: 'login_mfa',
      codigoHash,
      expiraEm: new Date(now.getTime() + LOGIN_MFA.EXPIRATION_MS),
    });
  });

  // Ao contrário de identifyEmail, aqui NÃO é fire-and-forget: MFA é um
  // portão obrigatório sem caminho alternativo — se o e-mail falhar, o
  // usuário fica esperando um código que nunca chega. Propaga o erro
  // (sendLoginMfaCode já lança EMAIL_UNAVAILABLE) em vez de mascarar.
  await sendLoginMfaCode(emailConfig, { to: usuario.email, code });

  return { mfaRequired: true, userId: usuario.id, mfaCodeId: codigoCriado.id };
}

/** @param {{ email: string, verificationCode: string }} input */
export async function verifyActivationCode({ email, verificationCode }) {
  const usuario = await getUserEmailAndPassword({ email });
  if (!usuario || usuario.senhaHash)
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_ACTIVATION_CODE,
      'Código inválido ou expirado'
    );

  const registro = await getLatestCodigoVerificacao({
    usuarioId: usuario.id,
    proposito: 'ativacao_senha',
  });
  const now = new Date();

  if (!isCodigoVerificacaoUsable(registro, now, PASSWORD_ACTIVATION.MAX_ATTEMPTS)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_ACTIVATION_CODE,
      'Código inválido ou expirado'
    );
  }

  const codigoValido = await bcrypt.compare(
    verificationCode,
    registro.codigoHash
  );

  if (!codigoValido) {
    await incrementCodigoVerificacaoAttempts({
      codigoId: registro.id,
      validAfter: now,
      maxAttempts: PASSWORD_ACTIVATION.MAX_ATTEMPTS,
      incrementBy: PASSWORD_ACTIVATION.ATTEMPT_INCREMENT,
    });
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_ACTIVATION_CODE,
      'Código inválido ou expirado'
    );
  }

  return { userId: usuario.id, activationCodeId: registro.id };
}

/** @param {{ userId: string, mfaCodeId: string, verificationCode: string }} input */
export async function verifyLoginMfaCode({ userId, mfaCodeId, verificationCode }) {
  const registro = await getLatestCodigoVerificacao({
    usuarioId: userId,
    proposito: 'login_mfa',
  });
  const now = new Date();

  if (!isCodigoVerificacaoUsable(registro, now, LOGIN_MFA.MAX_ATTEMPTS) || registro.id !== mfaCodeId) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_MFA_CODE,
      'Código inválido ou expirado'
    );
  }

  const codigoValido = await bcrypt.compare(
    verificationCode,
    registro.codigoHash
  );

  if (!codigoValido) {
    await incrementCodigoVerificacaoAttempts({
      codigoId: registro.id,
      validAfter: now,
      maxAttempts: LOGIN_MFA.MAX_ATTEMPTS,
      incrementBy: LOGIN_MFA.ATTEMPT_INCREMENT,
    });
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_MFA_CODE,
      'Código inválido ou expirado'
    );
  }

  const usuario = await getUserById({ userId });
  if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_USER_INACTIVE,
      'Usuário inativo'
    );
  }

  return toTenantContext(usuario);
}

/** @param {{ userId: string, activationCodeId: string, senha: string }} input */
export async function activatePassword({ userId, activationCodeId, senha }) {
  const senhaHash = await bcrypt.hash(senha, PASSWORD_POLICY.HASH_ROUNDS);
  const now = new Date();
  const usuario = await runInTransaction(
    async (repository) => {
      const codigoAtualizado = await repository.consumeCodigoVerificacao({
        userId,
        codigoId: activationCodeId,
        usadoEm: now,
        validAfter: now,
      });

      if (
        codigoAtualizado.count !== PASSWORD_ACTIVATION.EXPECTED_UPDATE_COUNT
      ) {
        throw unauthorizedError(
          ERROR_CODES.AUTH_INVALID_ACTIVATION_TOKEN,
          'Token de ativação inválido ou expirado'
        );
      }

      const usuarioAtualizado = await repository.setUserPasswordIfMissing({
        userId,
        senhaHash,
      });

      if (
        usuarioAtualizado.count !== PASSWORD_ACTIVATION.EXPECTED_UPDATE_COUNT
      ) {
        throw conflictError(
          ERROR_CODES.AUTH_PASSWORD_ALREADY_SET,
          'Este usuário já possui senha'
        );
      }

      const usuarioAtual = await repository.getUserById({ userId });
      if (!usuarioAtual.ativo || !ROLES_VALIDOS.includes(usuarioAtual.role)) {
        throw unauthorizedError(
          ERROR_CODES.AUTH_USER_INACTIVE,
          'Usuário inativo'
        );
      }
      return usuarioAtual;
    }
  );

  return toTenantContext(usuario);
}

/**
 * @param {{ userId: string }} input
 * @returns {Promise<import('#core/types/module.js').TenantContext>}
 */
export async function getUserContext({ userId }) {
  const usuario = await getUserById({ userId });

  if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN,
      'Refresh token inválido ou expirado'
    );
  }

  return {
    tenantId: usuario.tenantId,
    userId: usuario.id,
    role: /** @type {import('#core/types/module.js').Role} */ (usuario.role),
  };
}

/** @param {{ userId: string }} input */
export async function enableMfa({ userId }) {
  const usuario = await getUserById({ userId });

  if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_USER_INACTIVE,
      'Usuário inativo'
    );
  }

  // Ligar não exige senha de novo — aumentar segurança não precisa de
  // fricção extra (diferente de desligar, ver disableMfa).
  return setMfaAtivo({ userId, ativo: true });
}

/** @param {{ userId: string, senha: string }} input */
export async function disableMfa({ userId, senha }) {
  const usuario = await getUserById({ userId });

  if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_USER_INACTIVE,
      'Usuário inativo'
    );
  }

  const senhaValida = usuario.senhaHash
    ? await bcrypt.compare(senha, usuario.senhaHash)
    : false;

  if (!senhaValida) {
    throw unauthorizedError(
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'Senha inválida'
    );
  }

  return setMfaAtivo({ userId, ativo: false });
}

/** @param {{ id: string, tenantId: string, role: string }} usuario */
function toTenantContext(usuario) {
  return {
    tenantId: usuario.tenantId,
    userId: usuario.id,
    role: /** @type {import('#core/types/module.js').Role} */ (usuario.role),
  };
}

/** @param {string} code @param {string} message */
function unauthorizedError(code, message) {
  return new AppError({
    code,
    message,
    statusCode: HTTP_STATUS.UNAUTHORIZED,
  });
}

/** @param {string} code @param {string} message */
function conflictError(code, message) {
  return new AppError({
    code,
    message,
    statusCode: HTTP_STATUS.CONFLICT,
  });
}

/**
 * @param {{ usadoEm: Date | null, expiraEm: Date, tentativas: number } | null} registro
 * @param {Date} now
 * @param {number} maxAttempts
 */
function isCodigoVerificacaoUsable(registro, now, maxAttempts) {
  return Boolean(
    registro &&
    registro.usadoEm === null &&
    registro.expiraEm > now &&
    registro.tentativas < maxAttempts
  );
}
