import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PASSWORD_ACTIVATION, PASSWORD_POLICY } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { ROLES_VALIDOS } from '#core/types/module.js';
import { sendPasswordActivationCode } from '#core/email/smtp.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { LoginRepository } from '../repositories/login.repository.js';

export class LoginService {
  /**
   * @param {{ email: string, emailConfig: Parameters<typeof sendPasswordActivationCode>[0] }} input
   */
  static async identifyEmail({ email, emailConfig }) {
    const usuario = await LoginRepository.getUserEmailAndPassword({ email });

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

    const codigoCriado = await LoginRepository.runInTransaction(
      async (repository) => {
        await repository.invalidateUnusedActivationCodes({
          usuarioId: usuario.id,
          usadoEm: now,
        });

        return repository.createActivationCode({
          usuarioId: usuario.id,
          tenantId: usuario.tenantId,
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
        await LoginRepository.invalidateActivationCode({
          activationCodeId: codigoCriado.id,
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
   * @param {{ email: string, senha: string }} input
   * @returns {Promise<import('#core/types/module.js').TenantContext>}
   */
  static async authenticateWithPassword({ email, senha }) {
    const usuario = await LoginRepository.getUserEmailAndPassword({ email });
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

    return toTenantContext(usuario);
  }

  /** @param {{ email: string, verificationCode: string }} input */
  static async verifyActivationCode({ email, verificationCode }) {
    const usuario = await LoginRepository.getUserEmailAndPassword({ email });
    if (!usuario || usuario.senhaHash)
      throw unauthorizedError(
        ERROR_CODES.AUTH_INVALID_ACTIVATION_CODE,
        'Código inválido ou expirado'
      );

    const registro = await LoginRepository.getLatestActivationCode({
      usuarioId: usuario.id,
    });
    const now = new Date();

    if (!isActivationCodeUsable(registro, now)) {
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
      await LoginRepository.incrementActivationAttempts({
        activationCodeId: registro.id,
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

  /** @param {{ userId: string, activationCodeId: string, senha: string }} input */
  static async activatePassword({ userId, activationCodeId, senha }) {
    const senhaHash = await bcrypt.hash(senha, PASSWORD_POLICY.HASH_ROUNDS);
    const now = new Date();
    const usuario = await LoginRepository.runInTransaction(
      async (repository) => {
        const codigoAtualizado = await repository.consumeActivationCode({
          userId,
          activationCodeId,
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
  static async getUserContext({ userId }) {
    const usuario = await LoginRepository.getUserById({ userId });

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
 */
function isActivationCodeUsable(registro, now) {
  return Boolean(
    registro &&
    registro.usadoEm === null &&
    registro.expiraEm > now &&
    registro.tentativas < PASSWORD_ACTIVATION.MAX_ATTEMPTS
  );
}
