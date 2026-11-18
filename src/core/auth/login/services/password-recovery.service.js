import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PASSWORD_POLICY, PASSWORD_RECOVERY } from '#core/auth/constants.js';
import { sendPasswordRecoveryCode } from '#core/email/smtp.js';
import { AppError } from '#core/errors/app-error.js';
import { ROLES_VALIDOS } from '#core/types/module.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  getUserEmailAndPassword,
  getLatestCodigoVerificacao,
  incrementCodigoVerificacaoAttempts,
  invalidateCodigoVerificacao,
} from '../repositories/login.repository.js';
import {
  createRecoveryCode,
  replacePassword,
} from '../repositories/password-recovery.repository.js';

const REQUEST_MESSAGE =
  'Se houver uma conta ativa com este e-mail, você receberá um código de recuperação.';

export async function requestPasswordRecovery({ email, emailConfig }) {
  const usuario = await getUserEmailAndPassword({ email });
  if (!canRecover(usuario)) {
    return { message: REQUEST_MESSAGE };
  }
  const code = String(
    randomInt(PASSWORD_RECOVERY.CODE_MIN_VALUE, PASSWORD_RECOVERY.CODE_MAX_VALUE_EXCLUSIVE),
  );
  const codigoHash = await bcrypt.hash(code, PASSWORD_RECOVERY.CODE_HASH_ROUNDS);
  const registro = await createRecoveryCode({ usuario, codigoHash, now: new Date() });
  if (registro) {
    try {
      await sendPasswordRecoveryCode(emailConfig, { to: usuario.email, code });
    } catch (error) {
      await invalidateCodigoVerificacao({
        codigoId: registro.id,
        usuarioId: usuario.id,
        usadoEm: new Date(),
      });
      throw error;
    }
  }
  return { message: REQUEST_MESSAGE };
}

export async function resetPassword({ email, verificationCode, senha }) {
  const usuario = await getUserEmailAndPassword({ email });
  if (!canRecover(usuario)) {
    throw invalidCode();
  }
  const registro = await getLatestCodigoVerificacao({
    usuarioId: usuario.id,
    proposito: PASSWORD_RECOVERY.PURPOSE,
  });
  const now = new Date();
  if (
    !registro ||
    registro.usadoEm ||
    registro.expiraEm <= now ||
    registro.tentativas >= PASSWORD_RECOVERY.MAX_ATTEMPTS
  ) {
    throw invalidCode();
  }
  // Reserva cada tentativa antes de comparar para limitar também requisições simultâneas.
  const attempt = await incrementCodigoVerificacaoAttempts({
    codigoId: registro.id,
    validAfter: now,
    maxAttempts: PASSWORD_RECOVERY.MAX_ATTEMPTS,
    incrementBy: PASSWORD_RECOVERY.ATTEMPT_INCREMENT,
  });
  if (
    attempt.count !== PASSWORD_RECOVERY.EXPECTED_UPDATE_COUNT ||
    !(await bcrypt.compare(verificationCode, registro.codigoHash))
  ) {
    throw invalidCode();
  }
  const senhaHash = await bcrypt.hash(senha, PASSWORD_POLICY.HASH_ROUNDS);
  await replacePassword({
    usuario,
    codigoId: registro.id,
    senhaHash,
    now: new Date(),
    invalidCode,
  });
  return { message: 'Senha redefinida. Entre com sua nova senha.' };
}

function canRecover(usuario) {
  return usuario?.ativo && usuario.senhaHash && ROLES_VALIDOS.includes(usuario.role);
}

function invalidCode() {
  return new AppError({
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    code: ERROR_CODES.AUTH_INVALID_RECOVERY_CODE,
    message: 'Código inválido ou expirado. Solicite um novo código.',
  });
}
