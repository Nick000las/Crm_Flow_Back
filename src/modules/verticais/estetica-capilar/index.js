import { authenticateHook } from '#core/auth/rbac.js';

/**
 * STUB — primeiro módulo vertical candidato (ticket alto, sem concorrente maduro).
 * @type {import('#core/types/module.js').Module}
 */
export const esteticaCapilarModule = {
  key: 'estetica_capilar',
  name: 'Estética Capilar',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
  },
};
