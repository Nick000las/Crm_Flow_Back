import { registrarEmailsKanban } from './services/notifications.service.js';
import { registrarSocketsKanban } from './controllers/realtime.controller.js';
import { registrarRotasKanbanCompleto } from './controllers/kanban.controller.js';
import { registrarRotasBoards } from './controllers/boards.controller.js';
import { registrarRotasQuadros } from './controllers/quadros.controller.js';
import { registrarRotasVinculos } from './controllers/vinculos.controller.js';
import { KANBAN_FEATURES, MODULO_KANBAN } from './constants.js';

/** @type {import('#core/types/module.js').Module} */
export const kanbanUniversalModule = {
  key: MODULO_KANBAN,
  name: 'Motor de Kanban Universal',
  featureFlags: Object.values(KANBAN_FEATURES),
  // Autenticação e módulo contratado já são aplicados por `#api/app.js`
  // a todo módulo, antes destas rotas. O socket faz a própria checagem.
  async registerRoutes(app) {
    registrarSocketsKanban(app);
    registrarEmailsKanban(app);
    registrarRotasBoards(app);
    registrarRotasQuadros(app);
    registrarRotasVinculos(app);
    registrarRotasKanbanCompleto(app);
  },
};
