import nodemailer from 'nodemailer';
import { PASSWORD_ACTIVATION } from '#core/auth/constants.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

/**
 * @param {{
 *   SMTP_HOST?: string,
 *   SMTP_PORT: number,
 *   SMTP_SECURE: boolean,
 *   SMTP_USER?: string,
 *   SMTP_PASS?: string,
 * }} config
 * @param {{ to: string, code: string }} input
 */
export async function sendPasswordActivationCode(config, { to, code }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = config;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw Object.assign(new Error('Envio de e-mail não configurado'), {
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    });
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_USER,
    to,
    subject: 'Código para criar sua senha',
    text: `Seu código de verificação é ${code}. Ele expira em ${PASSWORD_ACTIVATION.EXPIRATION_MINUTES} minutos.`,
    html: `<p>Seu código de verificação é <strong>${code}</strong>.</p><p>Ele expira em ${PASSWORD_ACTIVATION.EXPIRATION_MINUTES} minutos.</p>`,
  });
}
