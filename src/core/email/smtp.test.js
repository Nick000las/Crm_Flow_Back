import nodemailer from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOGIN_MFA, PASSWORD_ACTIVATION } from '#core/auth/constants.js';

import {
  sendKanbanNotification,
  sendLoginMfaCode,
  sendPasswordActivationCode,
  sendPasswordRecoveryCode,
} from './smtp.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));

const TEST_SMTP_PORT = 587;
const TEST_TIMEOUT_MS = 1000;
const config = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_USER: 'no-reply@example.invalid',
  SMTP_PASS: 'test-only',
  SMTP_PORT: TEST_SMTP_PORT,
  SMTP_SECURE: false,
  SMTP_TIMEOUT_MS: TEST_TIMEOUT_MS,
  FRONTEND_URL: 'https://crm.example.invalid',
};
const input = {
  email: 'user@example.invalid',
  titulo: 'Revisar <script>conteúdo</script>',
  quadro: 'Projeto',
  kind: 'mention',
  id: 'notification',
  boardId: 'board',
};
let transport;

beforeEach(() => {
  vi.clearAllMocks();
  transport = { sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() };
  vi.mocked(nodemailer.createTransport).mockReturnValue(transport);
});

describe('e-mail de produto Kanban', () => {
  it('envia somente texto, link autenticado e Message-ID estável sem credenciais no conteúdo', async () => {
    await sendKanbanNotification(config, input);

    const message = transport.sendMail.mock.calls[0][0];

    expect(message.to).toBe(input.email);
    expect(message.text).toContain('https://crm.example.invalid/kanban?quadro=board');
    expect(message.messageId).toBe('<kanban-notification@crm.example.invalid>');
    expect(message).not.toHaveProperty('html');
    expect(message.text).not.toContain(config.SMTP_PASS);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('fecha conexão e propaga erro para a fila programar nova tentativa', async () => {
    transport.sendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(sendKanbanNotification(config, input)).rejects.toThrow('SMTP unavailable');
    expect(transport.close).toHaveBeenCalledTimes(1);
  });
});

describe('e-mails de verificação', () => {
  it.each([
    [
      sendPasswordActivationCode,
      'Código para criar sua senha',
      PASSWORD_ACTIVATION.EXPIRATION_MINUTES,
    ],
    [
      sendPasswordRecoveryCode,
      'Código para recuperar sua conta',
      PASSWORD_ACTIVATION.EXPIRATION_MINUTES,
    ],
    [sendLoginMfaCode, 'Código de verificação de login', LOGIN_MFA.EXPIRATION_MINUTES],
  ])(
    'envia HTML e texto para o destinatário com prazo e assunto originais: %s',
    async (send, subject, minutes) => {
      await send(config, { to: 'user@example.invalid', code: '012345' });

      const message = transport.sendMail.mock.calls[0][0];

      expect(message.to).toBe('user@example.invalid');
      expect(message.from).toEqual({ name: 'Flow CRM', address: config.SMTP_USER });
      expect(message.subject).toBe(subject);
      expect(message.html).toContain('012345');
      expect(message.text).toContain('012345');
      expect(message.text).toContain(`${minutes} minutos`);
      expect(message.html).toContain(`${minutes} minutos`);
      expect(message.html).not.toContain(config.SMTP_PASS);
      expect(transport.close).toHaveBeenCalledTimes(1);
    },
  );

  it('mantém EMAIL_UNAVAILABLE e fecha o transporte em falhas de envio', async () => {
    transport.sendMail.mockRejectedValue(new Error('SMTP unavailable'));

    await expect(
      sendLoginMfaCode(config, { to: 'user@example.invalid', code: '012345' }),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE' });

    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('recusa SMTP incompleto antes de criar uma conexão', async () => {
    await expect(
      sendPasswordActivationCode(
        { ...config, SMTP_HOST: undefined },
        { to: 'user@example.invalid', code: '012345' },
      ),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE' });

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
