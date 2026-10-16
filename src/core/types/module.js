/**
 * Contrato que TODO módulo deve implementar. Ver MODULE_CONTRACT.md na raiz.
 *
 * Sem TypeScript, o contrato é documentado por JSDoc (checado pelo editor) e
 * validado em runtime por `assertModule` — nada aqui é apenas decorativo.
 *
 * @typedef {object} Module
 * @property {string} key
 * @property {string} name
 * @property {(app: import('fastify').FastifyInstance) => void | Promise<void>} registerRoutes
 * @property {string[]} [featureFlags]  catálogo das flags do módulo, cada uma
 *   prefixada pela `key` (`crm.listas`) — o que o MASTER pode ligar por
 *   tenant (`#core/tenant/feature-flags.js`)
 * @property {(tenantId: string) => Promise<unknown>} [reconciliar]  ajustes
 *   idempotentes do estado do módulo num tenant (ex: semear configuração
 *   padrão). Pode rodar quantas vezes for preciso — `scripts/reconcile.js`
 */

/**
 * @typedef {'MASTER' | 'DONO' | 'OPERADOR'} Role
 *
 * @typedef {object} TenantContext
 * @property {string} tenantId
 * @property {string} userId
 * @property {Role} role
 */

/** Papéis aceitos em `TenantContext.role` (espelha `ROLES` em `#shared/constants/index.js`). */
export const ROLES_VALIDOS = Object.freeze(['MASTER', 'DONO', 'OPERADOR']);

/**
 * Valida em runtime o que o `interface Module` garantia em compile time.
 * Chamado ao registrar cada módulo (`#api/server.js`), de modo que um módulo
 * mal formado quebra no boot — e não numa requisição em produção.
 *
 * @param {unknown} candidato
 * @returns {Module}
 */
export function assertModule(candidato) {
  const mod = /** @type {Partial<Module>} */ (candidato);

  if (!mod || typeof mod !== 'object') {
    throw new Error('Módulo inválido: esperado um objeto que implemente o contrato Module.');
  }
  if (typeof mod.key !== 'string' || mod.key.length === 0) {
    throw new Error('Módulo inválido: `key` obrigatória (string não vazia).');
  }
  if (typeof mod.name !== 'string' || mod.name.length === 0) {
    throw new Error(`Módulo "${mod.key}" inválido: \`name\` obrigatório (string não vazia).`);
  }
  if (typeof mod.registerRoutes !== 'function') {
    throw new Error(`Módulo "${mod.key}" inválido: \`registerRoutes(app)\` obrigatório.`);
  }
  if (mod.featureFlags !== undefined) {
    if (!Array.isArray(mod.featureFlags)) {
      throw new Error(`Módulo "${mod.key}" inválido: \`featureFlags\` deve ser um array.`);
    }
    const semPrefixo = mod.featureFlags.find((flag) => typeof flag !== 'string' || !flag.startsWith(`${mod.key}.`));
    if (semPrefixo !== undefined) {
      throw new Error(`Módulo "${mod.key}" inválido: a flag "${semPrefixo}" deve começar com "${mod.key}.".`);
    }
  }
  if (mod.reconciliar !== undefined && typeof mod.reconciliar !== 'function') {
    throw new Error(`Módulo "${mod.key}" inválido: \`reconciliar(tenantId)\` deve ser função.`);
  }

  return /** @type {Module} */ (mod);
}
