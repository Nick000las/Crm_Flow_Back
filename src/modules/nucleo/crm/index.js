import { registrarRotasLeads } from './controllers/leads.controller.js';
import { registrarRotasDefinicoes } from './controllers/field-definitions.controller.js';
import { registrarRotasViews } from './controllers/filter-views.controller.js';
import { registrarRotasImportExport } from './controllers/import-export.controller.js';
import { registrarRotasUsuarios } from './controllers/usuarios.controller.js';
import { registrarRotasConfiguracoes } from './controllers/configuracoes.controller.js';
import { registrarRotasLayout } from './controllers/layout.controller.js';
import { registrarRotasListas } from './controllers/listas.controller.js';
import { registrarRotasAtividades } from './controllers/atividades.controller.js';
import { CRM_FEATURES, MODULO_CRM } from './constants.js';
import { reconciliarTenant } from './services/reconcile.service.js';

/** @type {import('#core/types/module.js').Module} */
export const crmModule = {
  key: MODULO_CRM,
  name: 'CRM de Vendas',
  featureFlags: Object.values(CRM_FEATURES),
  reconciliar: reconciliarTenant,
  // Autenticação e módulo contratado já são aplicados por `#api/app.js`
  // a todo módulo, antes destas rotas.
  async registerRoutes(app) {
    registrarRotasLeads(app);
    registrarRotasDefinicoes(app);
    registrarRotasViews(app);
    registrarRotasUsuarios(app);
    registrarRotasConfiguracoes(app);
    registrarRotasListas(app);
    registrarRotasLayout(app);
    registrarRotasAtividades(app);
    await registrarRotasImportExport(app);
  },
};
