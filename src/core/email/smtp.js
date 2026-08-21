import nodemailer from 'nodemailer';
import { PASSWORD_ACTIVATION } from '#core/auth/constants.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * @param {{
 *   SMTP_HOST?: string,
 *   SMTP_PORT: number,
 *   SMTP_SECURE: boolean,
 *   SMTP_USER?: string,
 *   SMTP_PASS?: string,
 *   SMTP_TIMEOUT_MS: number,
 * }} config
 * @param {{ to: string, code: string }} input
 */
export async function sendPasswordActivationCode(config, { to, code }) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_TIMEOUT_MS,
  } = config;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw emailUnavailableError();
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  try {
    await transporter.sendMail({
      from: SMTP_USER,
      to,
      subject: 'Código para criar sua senha',
      text: `Seu código de verificação é ${code}. Ele expira em ${PASSWORD_ACTIVATION.EXPIRATION_MINUTES} minutos.`,
      html: `<p>Seu código de verificação é <strong>${code}</strong>.</p><p>Ele expira em ${PASSWORD_ACTIVATION.EXPIRATION_MINUTES} minutos.</p>`,
    });
  } catch (error) {
    throw emailUnavailableError(error);
  }
}

/** @param {unknown} [cause] */
function emailUnavailableError(cause) {
  return new AppError({
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.EMAIL_UNAVAILABLE,
    message: 'O envio de e-mail está temporariamente indisponível',
    cause,
  });
}
