import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PASSWORD_ACTIVATION, PASSWORD_POLICY } from '#core/auth/constants.js';
import { ROLES_VALIDOS } from '#core/types/module.js';
import { sendPasswordActivationCode } from '#core/email/smtp.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { LoginRepository } from '../repositories/login.repository.js';

export class LoginService {
  /**
   * @param {{ email: string, emailConfig: Parameters<typeof sendPasswordActivationCode>[0] }} input
   */
  static async identifyEmail({ email, emailConfig }) {
    const usuario = await LoginRepository.getUserEmailAndPassword({ email });

    if (!usuario || !usuario.ativo || !ROLES_VALIDOS.includes(usuario.role)) {
      throw unauthorizedError('Convite não encontrado para este e-mail');
    }

    if (usuario.senhaHash) {
      return { nextStep: 'password' };
    }

    const now = new Date();
    const ultimoCodigo = await LoginRepository.getLatestActivationCode({
      usuarioId: usuario.id,
    });

    if (
      ultimoCodigo?.createdAt &&
      now.getTime() - ultimoCodigo.createdAt.getTime() <
        PASSWORD_ACTIVATION.RESEND_COOLDOWN_MS
    ) {
      throw Object.assign(
        new Error('Aguarde um minuto antes de solicitar outro código'),
        {
          statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
        }
      );
    }

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

    await LoginRepository.runInTransaction(async (repository) => {
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
    });

    sendPasswordActivationCode(emailConfig, { to: usuario.email, code });

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
      throw unauthorizedError('E-mail ou senha inválidos');
    }

    return toTenantContext(usuario);
  }

  /** @param {{ email: string, codigo: string }} input */
  static async verifyActivationCode({ email, codigo }) {
    const usuario = await LoginRepository.getUserEmailAndPassword({ email });
    if (!usuario || usuario.senhaHash)
      throw unauthorizedError('Código inválido ou expirado');

    const registro = await LoginRepository.getLatestActivationCode({
      usuarioId: usuario.id,
    });
    const now = new Date();

    if (!isActivationCodeUsable(registro, now)) {
      throw unauthorizedError('Código inválido ou expirado');
    }

    const codigoValido = await bcrypt.compare(codigo, registro.codigoHash);

    if (!codigoValido) {
      await LoginRepository.incrementActivationAttempts({
        activationCodeId: registro.id,
        validAfter: now,
        maxAttempts: PASSWORD_ACTIVATION.MAX_ATTEMPTS,
        incrementBy: PASSWORD_ACTIVATION.ATTEMPT_INCREMENT,
      });
      throw unauthorizedError('Código inválido ou expirado');
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
          throw unauthorizedError('Token de ativação inválido ou expirado');
        }

        const usuarioAtualizado = await repository.setUserPasswordIfMissing({
          userId,
          senhaHash,
        });

        if (
          usuarioAtualizado.count !== PASSWORD_ACTIVATION.EXPECTED_UPDATE_COUNT
        ) {
          throw conflictError('Este usuário já possui senha');
        }

        const usuarioAtual = await repository.getUserById({ userId });
        if (!usuarioAtual.ativo || !ROLES_VALIDOS.includes(usuarioAtual.role)) {
          throw unauthorizedError('Usuário inativo');
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
      throw unauthorizedError('Refresh token inválido ou expirado');
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

/** @param {string} message */
function unauthorizedError(message) {
  return Object.assign(new Error(message), {
    statusCode: HTTP_STATUS.UNAUTHORIZED,
  });
}

/** @param {string} message */
function conflictError(message) {
  return Object.assign(new Error(message), {
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
