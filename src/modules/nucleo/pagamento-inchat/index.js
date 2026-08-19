import { authenticateHook } from '#core/auth/rbac.js';

/**
 * STUB — implementar checkout conversacional Pix/cartão/boleto in-chat.
 * @type {import('#core/types/module.js').Module}
 */
export const pagamentoInChatModule = {
  key: 'pagamento_inchat',
  name: 'Pagamento In-Chat',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
  },
};
