import { ROLES } from '#shared/constants/index.js';

/** `Module.key` do CRM (`tenant_modules.module_key`). */
export const MODULO_CRM = 'crm';

/** `tipo` da pessoa em `Module.entidades`: a referência usada por outros módulos. */
export const ENTIDADE_PESSOA = 'pessoa';

/** Id de rota (uuid), para conferências que rodam antes da validação da rota. */
export const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Papéis que podem mexer na configuração do CRM (campos customizados,
 * visibilidade da Camada 2) e em import/export. OPERADOR fica com o CRUD de
 * leads, busca e views salvas.
 */
export const PAPEIS_GESTAO = Object.freeze([ROLES.DONO, ROLES.MASTER]);

/**
 * Catálogo das feature flags do CRM (`docs/crm/plano-configuracoes.md`).
 * Rollout gradual e kill switch, não cobrança — cada uma sai do código
 * 1-2 releases depois de estabilizar. Desligada = comportamento atual.
 */
export const CRM_FEATURES = Object.freeze({
  LISTAS: 'crm.listas',
  LAYOUT: 'crm.layout',
  ARQUIVO: 'crm.arquivo',
  ATIVIDADES: 'crm.atividades',
  DUPLICIDADE: 'crm.duplicidade',
  REGRAS: 'crm.regras',
  INATIVIDADE: 'crm.inatividade',
  MASSA: 'crm.massa',
  CNPJ: 'crm.cnpj',
  DISTRIBUICAO: 'crm.distribuicao',
  PERMISSOES: 'crm.permissoes',
  SCORE: 'crm.score',
  LGPD: 'crm.lgpd',
  TIMELINE: 'crm.timeline',
  QUADRO_COMERCIAL: 'crm.quadro_comercial',
});
