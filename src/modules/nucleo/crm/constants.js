/**
 * Constantes do módulo CRM. `FIELD_DEFINITION_TIPOS` espelha o CHECK
 * constraint de `modulo_crm.tenant_lead_field_definitions.tipo`
 * (prisma/migrations/0008_crm_lead_field_definitions) — uma única fonte
 * pro service validar e pro schema Zod do controller reaproveitar, em vez
 * de repetir a lista dos 6 tipos em mais de um lugar.
 */
export const FIELD_DEFINITION_TIPOS = Object.freeze([
  'texto',
  'numero',
  'data',
  'booleano',
  'selecao',
  'selecao_multipla',
]);

export const TIPOS_COM_OPCOES = Object.freeze(['selecao', 'selecao_multipla']);
