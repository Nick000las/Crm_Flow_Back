import { registrarRotasLeads } from './controllers/leads.controller.js';
import { registrarRotasDefinicoes } from './controllers/field-definitions.controller.js';
import { registrarRotasVisibilidade } from './controllers/field-visibility.controller.js';
import { registrarRotasViews } from './controllers/filter-views.controller.js';
import { registrarRotasImportExport } from './controllers/import-export.controller.js';

/** @type {import('#core/types/module.js').Module} */
export const crmModule = {
  key: 'crm',
  name: 'CRM de Vendas',
  // Autenticação e módulo contratado já são aplicados por `#api/app.js`
  // a todo módulo, antes destas rotas.
  async registerRoutes(app) {
    registrarRotasLeads(app);
    registrarRotasDefinicoes(app);
    registrarRotasVisibilidade(app);
    registrarRotasViews(app);
    await registrarRotasImportExport(app);
  },
};
