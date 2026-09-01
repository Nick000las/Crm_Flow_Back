/**
 * Tipos do módulo CRM. Sem TypeScript, servem ao editor (via JSDoc) e como
 * documentação viva do contorno de dado que sai dos `adapters/`.
 *
 * @typedef {object} Lead
 * @property {string} id
 * @property {string} nome
 * @property {string} telefone
 * @property {number | null} valor
 * @property {string | null} estagio_nome
 */

/**
 * @typedef {object} CriarLeadInput
 * @property {string} nome
 * @property {string} telefone
 * @property {string} funilEstagioId
 */

/**
 * @typedef {'texto' | 'numero' | 'data' | 'booleano' | 'selecao' | 'selecao_multipla'} FieldDefinitionTipo
 */

/**
 * @typedef {object} FieldDefinition
 * @property {string} id
 * @property {string} chave
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 * @property {number} ordem
 * @property {string} created_at
 */

/**
 * @typedef {object} CriarFieldDefinitionInput
 * @property {string} chave
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 * @property {number} ordem
 */

/**
 * @typedef {object} AtualizarFieldDefinitionInput
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 */

export {};
