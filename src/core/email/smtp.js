import nodemailer from 'nodemailer';
import { LOGIN_MFA, PASSWORD_ACTIVATION } from '#core/auth/constants.js';
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
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_TIMEOUT_MS } = config;

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

export async function sendLoginMfaCode(config, { to, code }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_TIMEOUT_MS } = config;

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
      subject: 'Código de verificação de login',
      text: `Seu código de verificação é ${code}. Ele expira em ${LOGIN_MFA.EXPIRATION_MINUTES} minutos.`,
      html: `<p>Seu código de verificação é <strong>${code}</strong>.</p><p>Ele expira em ${LOGIN_MFA.EXPIRATION_MINUTES} minutos.</p>`,
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

const NOTIFICATION_TITLES = {
  assignment: 'Você recebeu um card',
  mention: 'Você foi mencionado em um comentário',
  due: 'Um card seu vence hoje',
};

/** O conteúdo dinâmico só entra em texto simples; não há HTML fornecido por usuários. */
export async function sendKanbanNotification(config, { email, titulo, quadro, kind, id, boardId }) {
  const title = NOTIFICATION_TITLES[kind];
  if (!title || !config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    throw emailUnavailableError();
  }
  const url = new URL('/kanban', config.FRONTEND_URL);
  url.searchParams.set('quadro', boardId);
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    connectionTimeout: config.SMTP_TIMEOUT_MS,
    greetingTimeout: config.SMTP_TIMEOUT_MS,
    socketTimeout: config.SMTP_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: config.SMTP_USER,
      to: email,
      subject: `[Kanban] ${title}`,
      messageId: `<kanban-${id}@${new URL(config.FRONTEND_URL).hostname}>`,
      text: `${title}.\n\nCard: ${titulo}\nQuadro: ${quadro}\n\nAbrir quadro: ${url}\n\nVocê pode desativar estes avisos na opção E-mails do Kanban.`,
    });
  } finally {
    transport.close();
  }
}
