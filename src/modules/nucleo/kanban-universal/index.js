import { registrarEmailsKanban } from './services/notifications.service.js';
import { registrarSocketsKanban } from './controllers/realtime.controller.js';
import { authenticateHook } from '#core/auth/rbac.js';
import { registrarRotasKanbanCompleto } from './controllers/kanban.controller.js';
import { verificarModulo } from './services/kanban.service.js';
import { registrarRotasBoards } from './controllers/boards.controller.js';

/** @type {import('#core/types/module.js').Module} */
export const kanbanUniversalModule = {
  key: 'kanban_universal',
  name: 'Motor de Kanban Universal',
  async registerRoutes(app) {
    registrarSocketsKanban(app);
    registrarEmailsKanban(app);
    app.addHook('preHandler', authenticateHook);
    app.addHook('preHandler', async (req, reply) => {
      if (!reply.sent) {
        await verificarModulo(req.tenantContext.tenantId);
      }
    });
    registrarRotasBoards(app);
    registrarRotasKanbanCompleto(app);
  },
};
