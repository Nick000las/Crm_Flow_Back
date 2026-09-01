import { authenticateHook } from '#core/auth/rbac.js';
import { registrarRotasLeads } from './controllers/leads.controller.js';
import { registrarRotasDefinicoes } from './controllers/field-definitions.controller.js';

/** @type {import('#core/types/module.js').Module} */
export const crmModule = {
  key: 'crm',
  name: 'CRM de Vendas',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
    registrarRotasLeads(app);
    registrarRotasDefinicoes(app);
  },
};
