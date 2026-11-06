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
 * @property {ProvedorDeQuadro[]} [quadros]  quadros que o módulo publica no
 *   motor do Kanban (`#core/quadros/registro.js`)
 * @property {ProvedorDeEntidade[]} [entidades]  registros que outro módulo
 *   pode referenciar sem copiar dado
 */

/**
 * Conteúdo de um quadro que vem de outro módulo. `quadroRef`, `colunaRef` e
 * `entidadeId` são opacos para o motor. Erros de domínio saem como `AppError`
 * (`erroCamposObrigatorios` se faltar campo). Só existe o que está aqui: não
 * há editar coluna nem excluir card.
 *
 * @typedef {object} ProvedorDeQuadro
 * @property {string} boardType
 * @property {string} entidadeTipo  `tipo` do `ProvedorDeEntidade` dos cards
 * @property {(ctx: TenantContext) => Promise<{ quadroRef: string, nome: string }[]>} listarQuadros
 * @property {(ctx: TenantContext, quadroRef: string) => Promise<{ ref: string, nome: string, cor: string | null }[]>} listarColunas
 * @property {(ctx: TenantContext, quadroRef: string, consulta: { colunaRef: string, filtros?: object, cursor?: string, limite: number }) => Promise<{ itens: { entidadeId: string }[], proximoCursor: string | null }>} listarCards
 * @property {(ctx: TenantContext, quadroRef: string, consulta: { colunaRef: string, filtros?: object }) => Promise<{ total: number, soma: number | null }>} resumoColuna
 * @property {(ctx: TenantContext, entidadeId: string) => Promise<string[]>} acoesPermitidas
 * @property {(ctx: TenantContext, movimento: { quadroRef: string, entidadeId: string, colunaDestino: string, expectedUpdatedAt?: string }) => Promise<unknown>} mover
 * @property {(ctx: TenantContext, novo: { quadroRef: string, colunaRef: string, dados: object }) => Promise<unknown>} criar
 */

/**
 * Referência leve a um registro de outro módulo.
 *
 * @typedef {object} ProvedorDeEntidade
 * @property {string} tipo
 * @property {(ctx: TenantContext, ids: string[]) => Promise<{ id: string, idAtual?: string }[]>} descrever  o
 *   que este usuário pode ver; id ausente da resposta sai como restrito.
 *   `idAtual` difere de `id` quando o registro passou para outro (mesclagem)
 * @property {(id: string) => string} rotaFicha
 * @property {(tenantId: string, ids: string[]) => Promise<Record<string, string | null>>} resolverVinculos
 *   id → id atual (lead mesclado aponta para o principal) ou `null` se não
 *   existe mais. Sem usuário: é chamado por job
 */

/** Métodos obrigatórios de cada contrato, conferidos ao subir. */
const METODOS_DO_QUADRO = Object.freeze([
  'listarQuadros',
  'listarColunas',
  'listarCards',
  'resumoColuna',
  'acoesPermitidas',
  'mover',
  'criar',
]);
const METODOS_DA_ENTIDADE = Object.freeze(['descrever', 'rotaFicha', 'resolverVinculos']);

/**
 * @param {string} chaveDoModulo
 * @param {string} contrato  nome do campo em `Module`
 * @param {unknown} provedores
 * @param {string[]} identificadores  campos de texto obrigatórios
 * @param {readonly string[]} metodos
 */
function assertProvedores(chaveDoModulo, contrato, provedores, identificadores, metodos) {
  if (provedores === undefined) return;
  if (!Array.isArray(provedores)) {
    throw new Error(`Módulo "${chaveDoModulo}" inválido: \`${contrato}\` deve ser um array.`);
  }
  for (const provedor of provedores) {
    for (const campo of identificadores) {
      if (typeof provedor?.[campo] !== 'string' || provedor[campo].length === 0) {
        throw new Error(
          `Módulo "${chaveDoModulo}" inválido: \`${contrato}\` exige \`${campo}\` (string não vazia).`,
        );
      }
    }
    const faltando = metodos.find((metodo) => typeof provedor[metodo] !== 'function');
    if (faltando) {
      throw new Error(
        `Módulo "${chaveDoModulo}" inválido: \`${contrato}\` exige o método \`${faltando}\`.`,
      );
    }
  }
}

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
    const semPrefixo = mod.featureFlags.find(
      (flag) => typeof flag !== 'string' || !flag.startsWith(`${mod.key}.`),
    );
    if (semPrefixo !== undefined) {
      throw new Error(
        `Módulo "${mod.key}" inválido: a flag "${semPrefixo}" deve começar com "${mod.key}.".`,
      );
    }
  }
  if (mod.reconciliar !== undefined && typeof mod.reconciliar !== 'function') {
    throw new Error(`Módulo "${mod.key}" inválido: \`reconciliar(tenantId)\` deve ser função.`);
  }

  assertProvedores(
    mod.key,
    'quadros',
    mod.quadros,
    ['boardType', 'entidadeTipo'],
    METODOS_DO_QUADRO,
  );
  assertProvedores(mod.key, 'entidades', mod.entidades, ['tipo'], METODOS_DA_ENTIDADE);

  return /** @type {Module} */ (mod);
}
