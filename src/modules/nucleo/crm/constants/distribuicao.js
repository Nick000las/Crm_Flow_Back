/**
 * Distribuição automática de leads (M12, `docs/crm/plano-configuracoes.md`).
 */

/** Nenhuma regra decidiu: rodízio entre todos ou o lead fica sem responsável. */
export const FALLBACK_DISTRIBUICAO = Object.freeze({
  RODIZIO_GERAL: 'rodizio_geral',
  SEM_RESPONSAVEL: 'sem_responsavel',
});

export const LISTA_FALLBACK_DISTRIBUICAO = Object.freeze(Object.values(FALLBACK_DISTRIBUICAO));

export const TIPOS_DESTINO = Object.freeze({ USUARIO: 'usuario', GRUPO: 'grupo' });

export const LISTA_TIPOS_DESTINO = Object.freeze(Object.values(TIPOS_DESTINO));

/** `crm_rodizio_ponteiro.chave` do rodízio geral (o de grupo usa o id do grupo). */
export const CHAVE_RODIZIO_GERAL = 'geral';

/** De onde veio o responsável (`detalhes.distribuicao.origem` no evento `criado`). */
export const ORIGEM_DISTRIBUICAO = Object.freeze({
  REGRA: 'regra',
  RODIZIO_GERAL: 'rodizio_geral',
  SEM_RESPONSAVEL: 'sem_responsavel',
});

/** Tenant que nunca salvou: desligado (o criador vira o responsável, como antes). */
export const CONFIG_DISTRIBUICAO_PADRAO = Object.freeze({
  ativo: false,
  fallback: FALLBACK_DISTRIBUICAO.RODIZIO_GERAL,
});

export const LIMITES_DISTRIBUICAO = Object.freeze({
  REGRAS_POR_TENANT: 50,
  CONDICOES_POR_REGRA: 10,
  GRUPOS_POR_TENANT: 30,
  MEMBROS_POR_GRUPO: 200,
});

export const NOTIFICACOES_DISTRIBUICAO = Object.freeze({
  MODULO: 'crm',
  LEAD_ATRIBUIDO: 'crm.lead_atribuido',
  LEADS_ATRIBUIDOS: 'crm.leads_atribuidos',
  ROTA: '/crm/leads',
});
