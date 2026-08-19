import { authenticateHook } from '#core/auth/rbac.js';
import { registrarRotasKanban } from './controllers/board.controller.js';

/** @type {import('#core/types/module.js').Module} */
export const kanbanUniversalModule = {
  key: 'kanban_universal',
  name: 'Motor de Kanban Universal',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
    registrarRotasKanban(app);
  },
};
