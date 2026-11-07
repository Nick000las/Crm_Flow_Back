/** `crm_event.entidade`. */
export const ENTIDADE_OPORTUNIDADE = 'deal';

/**
 * `crm_event.tipo`. Consumidos no M5 (tempo real). O payload leva só ids e
 * chaves de status: evento não guarda dado pessoal.
 */
export const EVENTOS_OPORTUNIDADE = Object.freeze({
  CRIADA: 'deal.created',
  ATUALIZADA: 'deal.updated',
  STATUS_MUDOU: 'deal.status_changed',
  GANHA: 'deal.won',
  PERDIDA: 'deal.lost',
  REABERTA: 'deal.reopened',
  ARQUIVADA: 'deal.archived',
  DESARQUIVADA: 'deal.unarchived',
  EXCLUIDA: 'deal.deleted',
  RESTAURADA: 'deal.restored',
});

/** O que o CRM publica no motor do Kanban (M3). */
export const ROTULOS_DO_QUADRO = Object.freeze({
  BOARD_TYPE: 'crm_oportunidades',
  ENTIDADE: 'oportunidade',
  MOVER: 'mover',
});

/**
 * Ordens do quadro (M4, decisão do dono). `coluna` é texto fixo, nunca vem do
 * cliente. `campo`: só ordena por ele quem o vê, como em busca e filtro.
 */
export const ORDENS_DO_QUADRO = Object.freeze({
  atualizadoEm: Object.freeze({ coluna: 'l.deal_atualizada_em', tipo: 'timestamp' }),
  criadoEm: Object.freeze({ coluna: 'l.deal_criada_em', tipo: 'timestamp' }),
  nome: Object.freeze({ coluna: 'lower(l.nome)', tipo: 'text' }),
  valor: Object.freeze({ coluna: 'l.valor', tipo: 'numeric', campo: 'valor' }),
  dataPrevistaFechamento: Object.freeze({
    coluna: 'l.data_prevista_fechamento',
    tipo: 'timestamp',
    campo: 'dataPrevistaFechamento',
  }),
  probabilidadeFechamento: Object.freeze({
    coluna: 'l.probabilidade_fechamento',
    tipo: 'numeric',
    campo: 'probabilidadeFechamento',
  }),
});

export const DIRECOES_DE_ORDEM = Object.freeze({ ASC: 'asc', DESC: 'desc' });

/** Padrão da D2: última atualização, mais recente primeiro. */
export const ORDEM_PADRAO_DO_QUADRO = Object.freeze({
  campo: 'atualizadoEm',
  direcao: DIRECOES_DE_ORDEM.DESC,
});

/** Selos derivados do CRM a cada leitura; nada fica guardado no Kanban. */
export const SELOS_DO_CARD = Object.freeze({
  ESFRIANDO: 'esfriando',
  ORIGEM_REABERTA: 'origem_reaberta',
});

/**
 * Chaves do lead que moram na oportunidade principal (M2.5, F4). `/crm/leads`
 * continua aceitando e devolvendo todas; a gravação vai para `crm_deal`.
 */
export const CAMPOS_COMERCIAIS = Object.freeze([
  'status',
  'funilEstagioId',
  'valor',
  'probabilidadeFechamento',
  'dataPrevistaFechamento',
  'motivoPerda',
  'dataConversao',
]);

/** Limites de `crm_deal`: `amount NUMERIC(14, 2)` e `probability_override` de 0 a 100. */
export const LIMITES_OPORTUNIDADE = Object.freeze({
  VALOR_MAXIMO: 999_999_999_999.99,
  PROBABILIDADE_MAXIMA: 100,
  TITULO: 200,
});

/**
 * Campo configurável do CRM → chaves que ele controla na oportunidade. Campo
 * desligado ou oculto para o papel some da resposta, como em `/crm/leads`. A
 * categoria e as datas de fechamento contam o status: ocultam junto.
 */
export const SAIDA_DOS_CAMPOS_DA_OPORTUNIDADE = Object.freeze({
  status: Object.freeze(['status', 'categoria', 'ganhaEm', 'perdidaEm']),
  valor: Object.freeze(['valor']),
  motivoPerda: Object.freeze(['motivoPerda']),
  probabilidadeFechamento: Object.freeze(['probabilidadeFechamento']),
  dataPrevistaFechamento: Object.freeze(['dataPrevistaFechamento']),
  dataConversao: Object.freeze(['ganhaEm']),
});

/** Regra de quem assume o atendimento criado pela venda. */
export const REGRAS_DONO_ATENDIMENTO = Object.freeze({
  PESSOA: 'person_owner',
  USUARIO: 'specific_user',
  NINGUEM: 'none',
});
