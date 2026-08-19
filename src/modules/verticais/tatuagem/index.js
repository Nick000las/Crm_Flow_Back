import { authenticateHook } from '#core/auth/rbac.js';

/**
 * STUB — preço deve ser calibrado ao ticket do nicho, NÃO usar o preço padrão do combo.
 * @type {import('#core/types/module.js').Module}
 */
export const tatuagemModule = {
  key: 'tatuagem',
  name: 'Estúdio de Tatuagem',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
  },
};
