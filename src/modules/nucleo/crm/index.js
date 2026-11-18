/**
 * @file Registra e expõe as integrações de CRM definidas nesta pasta, preservando o contrato
 * público do módulo.
 */
import { CRM_FEATURES, MODULO_CRM } from './constants.js';
import { registrarRotasAtividades } from './controllers/atividades.controller.js';
import { registrarRotasCnpj } from './controllers/cnpj.controller.js';
import { registrarRotasConfiguracoes } from './controllers/configuracoes.controller.js';
import { registrarRotasDistribuicao } from './controllers/distribuicao.controller.js';
import { registrarRotasDuplicidade } from './controllers/duplicidade.controller.js';
import { registrarRotasDefinicoes } from './controllers/field-definitions.controller.js';
import { registrarRotasViews } from './controllers/filter-views.controller.js';
import { registrarRotasForecast } from './controllers/forecast.controller.js';
import { registrarRotasPublicasFormularios } from './controllers/formulario-publico.controller.js';
import { registrarRotasFormularios } from './controllers/formularios.controller.js';
import { registrarRotasImportExport } from './controllers/import-export.controller.js';
import { registrarRotasInatividade } from './controllers/inatividade.controller.js';
import { registrarRotasLayout } from './controllers/layout.controller.js';
import { registrarRotasLeads } from './controllers/leads.controller.js';
import { registrarRotasLgpd } from './controllers/lgpd.controller.js';
import { registrarRotasListas } from './controllers/listas.controller.js';
import { registrarRotasOportunidades } from './controllers/oportunidades.controller.js';
import { registrarRotasPermissoes } from './controllers/permissoes.controller.js';
import { registrarRotasPipelines } from './controllers/pipelines.controller.js';
import { registrarRotasRegras } from './controllers/regras.controller.js';
import { registrarRotasScore } from './controllers/score.controller.js';
import { registrarRotasUsuarios } from './controllers/usuarios.controller.js';
import { exigirVisibilidade } from './controllers/visibilidade.hook.js';
import { aoLigarFeaturesDoCrm } from './services/forecast-flag.service.js';
import { provedorDePessoa } from './services/pessoa-entidade.service.js';
import { provedorComercial, provedorDeOportunidade } from './services/quadro-comercial.service.js';
import { reconciliarTenant } from './services/reconcile.service.js';

/** @type {import('#core/types/module.js').Module} */
export const crmModule = {
  key: MODULO_CRM,
  name: 'CRM de Vendas',
  featureFlags: Object.values(CRM_FEATURES),
  reconciliar: reconciliarTenant,
  // Ligar `crm.forecast` liga os campos de que o forecast precisa (FC1).
  aoLigarFeatures: aoLigarFeaturesDoCrm,
  entidades: [provedorDePessoa, provedorDeOportunidade],
  quadros: [provedorComercial],
  // Sem login, sob `/public`: a página do link de formulário (FM3). Cada rota
  // descobre o tenant pelo token e confere módulo e flag.
  registerPublicRoutes(app) {
    registrarRotasPublicasFormularios(app);
  },
  // Autenticação e módulo contratado já são aplicados por `#api/app.js`
  // a todo módulo, antes destas rotas.
  async registerRoutes(app) {
    // Antes das rotas: hook só vale para as registradas depois dele.
    app.addHook('preHandler', exigirVisibilidade);
    registrarRotasLeads(app);
    registrarRotasDefinicoes(app);
    registrarRotasViews(app);
    registrarRotasUsuarios(app);
    registrarRotasConfiguracoes(app);
    registrarRotasListas(app);
    registrarRotasPipelines(app);
    registrarRotasOportunidades(app);
    registrarRotasLayout(app);
    registrarRotasAtividades(app);
    registrarRotasDuplicidade(app);
    registrarRotasRegras(app);
    registrarRotasInatividade(app);
    registrarRotasCnpj(app);
    registrarRotasDistribuicao(app);
    registrarRotasPermissoes(app);
    registrarRotasScore(app);
    registrarRotasLgpd(app);
    registrarRotasFormularios(app);
    registrarRotasForecast(app);
    await registrarRotasImportExport(app);
  },
};
