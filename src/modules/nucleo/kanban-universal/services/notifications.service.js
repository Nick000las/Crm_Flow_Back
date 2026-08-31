import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { sendKanbanNotification } from '#core/email/smtp.js';
import {
  listarEmpresasParaEmail,
  prepararEmails,
  carregarEmailAutorizado,
  concluirEmail,
} from '../adapters/notifications.repository.js';

const INTERVAL_MS = 60_000;

export async function processarEmails(config, logger, isStopping = () => false) {
  let after = null;
  do {
    const tenants = await listarEmpresasParaEmail(after);
    if (!tenants.length) {
      break;
    }
    for (const tenant of tenants) {
      if (isStopping()) {
        return;
      }
      const pending = await prepararEmails(tenant.id, config.KANBAN_EMAIL_TIMEZONE, randomUUID());
      for (const item of pending) {
        if (isStopping()) {
          return;
        }
        try {
          const recipient = await carregarEmailAutorizado(tenant.id, item);
          if (!recipient) {
            await concluirEmail(tenant.id, item, 'cancelled');
            continue;
          }
          await sendKanbanNotification(config, {
            ...recipient,
            kind: item.kind,
            id: item.id,
            boardId: item.board_id,
          });
          await concluirEmail(tenant.id, item, 'sent');
        } catch {
          logger.warn(
            { notificationId: item.id, tenantId: tenant.id },
            'Falha no e-mail Kanban; reenvio agendado.',
          );
          await concluirEmail(tenant.id, item, 'retry');
        }
      }
    }
    after = tenants.at(-1).id;
  } while (after);
}

export function registrarEmailsKanban(app) {
  const config = app.config;
  if (config.NODE_ENV === 'test' || !config.KANBAN_EMAIL_ENABLED) {
    return;
  }
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS || !config.FRONTEND_URL) {
    app.log.warn('E-mails Kanban aguardam SMTP e FRONTEND_URL configurados.');
    return;
  }
  let timer;
  let stopped = false;
  let running;
  const tick = () => {
    running = processarEmails(config, app.log, () => stopped)
      .catch(() => app.log.error('Falha ao processar fila de e-mails Kanban.'))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, INTERVAL_MS);
          timer.unref();
        }
      });
  };
  app.addHook('onReady', async () => {
    timer = setTimeout(tick, INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  });
}
