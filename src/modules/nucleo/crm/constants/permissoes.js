import { ROLES } from '#shared/constants/index.js';

/**
 * Permissão por campo (M13, `docs/crm/plano-configuracoes.md`). Espelha o
 * CHECK de `crm_field_permission.access` (migration 0012). Sem linha = `edit`.
 */
export const ACESSOS_CAMPO = Object.freeze({
  EDITAR: 'edit',
  VER: 'view',
  OCULTO: 'hidden',
});

export const LISTA_ACESSOS_CAMPO = Object.freeze(Object.values(ACESSOS_CAMPO));

/** Papéis com permissão configurável — DONO e MASTER ignoram (veem e editam tudo). */
export const PAPEIS_COM_PERMISSAO = Object.freeze([ROLES.OPERADOR]);

/** O lead sem nome não existe: o Nome é sempre editável. */
export const CHAVES_SEM_RESTRICAO = Object.freeze(['nome']);

/** "Pelo menos um dos dois" na criação: um deles fica editável pra cada papel. */
export const CHAVES_CONTATO = Object.freeze(['email', 'telefone']);
