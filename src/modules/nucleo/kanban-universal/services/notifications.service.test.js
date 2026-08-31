import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processarEmails, registrarEmailsKanban } from './notifications.service.js';
import { sendKanbanNotification } from '#core/email/smtp.js';
import {
  listarEmpresasParaEmail,
  prepararEmails,
  carregarEmailAutorizado,
  concluirEmail,
} from '../adapters/notifications.repository.js';
vi.mock('#core/email/smtp.js', () => ({ sendKanbanNotification: vi.fn() }));
vi.mock('../adapters/notifications.repository.js', () => ({
  listarEmpresasParaEmail: vi.fn(),
  prepararEmails: vi.fn(),
  carregarEmailAutorizado: vi.fn(),
  concluirEmail: vi.fn(),
}));
const config = { KANBAN_EMAIL_TIMEZONE: 'America/Sao_Paulo' };
const logger = { warn: vi.fn() };
const item = {
  id: 'notification',
  card_id: 'card',
  board_id: 'board',
  usuario_id: 'user',
  kind: 'assignment',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listarEmpresasParaEmail)
    .mockResolvedValueOnce([{ id: 'tenant' }])
    .mockResolvedValue([]);
  vi.mocked(prepararEmails).mockResolvedValue([item]);
  vi.mocked(carregarEmailAutorizado).mockResolvedValue({
    email: 'test@example.invalid',
    titulo: 'Tarefa',
    quadro: 'Projeto',
  });
  vi.mocked(sendKanbanNotification).mockResolvedValue(undefined);
});
describe('e-mails do Kanban', () => {
  it('revalida destinatário antes de enviar e confirma a entrega', async () => {
    await processarEmails(config, logger);
    expect(carregarEmailAutorizado).toHaveBeenCalledWith('tenant', item);
    expect(sendKanbanNotification).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        email: 'test@example.invalid',
        boardId: 'board',
        id: 'notification',
      }),
    );
    expect(concluirEmail).toHaveBeenCalledWith('tenant', item, 'sent');
  });
  it('cancela aviso após revogação, arquivamento ou opt-out', async () => {
    vi.mocked(carregarEmailAutorizado).mockResolvedValue(undefined);
    await processarEmails(config, logger);
    expect(sendKanbanNotification).not.toHaveBeenCalled();
    expect(concluirEmail).toHaveBeenCalledWith('tenant', item, 'cancelled');
  });
  it('agenda nova tentativa se SMTP falhar sem vazar conteúdo no log', async () => {
    vi.mocked(sendKanbanNotification).mockRejectedValue(new Error('smtp credentials'));
    await processarEmails(config, logger);
    expect(concluirEmail).toHaveBeenCalledWith('tenant', item, 'retry');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('credentials');
  });
  it('não inicia envios nos testes nem com feature desativada', () => {
    const addHook = vi.fn();
    registrarEmailsKanban({ config: { NODE_ENV: 'test', KANBAN_EMAIL_ENABLED: true }, addHook });
    registrarEmailsKanban({
      config: { NODE_ENV: 'production', KANBAN_EMAIL_ENABLED: false },
      addHook,
    });
    expect(addHook).not.toHaveBeenCalled();
  });
});
