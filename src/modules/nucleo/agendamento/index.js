import { authenticateHook } from '#core/auth/rbac.js';

/**
 * STUB — mesma estrutura de crm/ e kanban-universal/. Implementar Bloco 1.6.2.
 * @type {import('#core/types/module.js').Module}
 */
export const agendamentoModule = {
  key: 'agendamento',
  name: 'Agendamento',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
  },
};
