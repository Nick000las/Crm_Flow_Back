/**
 * @file Registra e expõe as integrações de Kanban definidas nesta pasta, preservando o contrato
 * público do módulo.
 */
import { KANBAN_FEATURES, MODULO_KANBAN } from './constants.js';
import { registrarRotasBoards } from './controllers/boards.controller.js';
import { registrarRotasKanbanCompleto } from './controllers/kanban.controller.js';
import { registrarRotasQuadros } from './controllers/quadros.controller.js';
import { registrarSocketsKanban } from './controllers/realtime.controller.js';
import { registrarRotasVinculos } from './controllers/vinculos.controller.js';
import { registrarEmailsKanban } from './services/notifications.service.js';

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
