import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendKanbanNotification } from './smtp.js';
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
