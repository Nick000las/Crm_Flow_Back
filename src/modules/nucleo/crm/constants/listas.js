/**
 * Listas configuráveis do CRM (docs/crm/plano-configuracoes.md, M3): cada
 * lista é um `kind` em `modulo_crm.crm_option`. A opção é identificada por
 * `key`, imutável e o que fica gravado no lead; `label`, cor, ordem,
 * categoria e ativo são do tenant.
 */
export const TIPOS_LISTA = Object.freeze({
  STATUS: 'status',
  FONTE_LEAD: 'fonte_lead',
  MOTIVO_PERDA: 'motivo_perda',
  TIPO_ATIVIDADE: 'tipo_atividade',
  TAG: 'tag',
});

export const LISTA_TIPOS_LISTA = Object.freeze(Object.values(TIPOS_LISTA));

/**
 * Categoria do status (só a lista `status` tem): regras e relatórios usam
 * a categoria, não o nome, pro tenant poder renomear "Perdido".
 */
export const CATEGORIAS_STATUS = Object.freeze({
  ABERTO: 'aberto',
  GANHO: 'ganho',
  PERDIDO: 'perdido',
});

export const LISTA_CATEGORIAS_STATUS = Object.freeze(Object.values(CATEGORIAS_STATUS));

/** Categorias que precisam de ao menos um status ativo (fechar o funil). */
export const CATEGORIAS_OBRIGATORIAS = Object.freeze([CATEGORIAS_STATUS.GANHO, CATEGORIAS_STATUS.PERDIDO]);

/**
 * Campo do sistema (`systemKey`) → lista que dá as opções dele. A coluna
 * do lead guarda a `key` da opção (`tags`: uma lista de keys).
 */
export const LISTA_DO_CAMPO = Object.freeze({
  status: TIPOS_LISTA.STATUS,
  fonteLead: TIPOS_LISTA.FONTE_LEAD,
  motivoPerda: TIPOS_LISTA.MOTIVO_PERDA,
  tags: TIPOS_LISTA.TAG,
});

/** Coluna de `modulo_crm.leads` de cada lista (texto fixo, nunca do cliente). */
export const COLUNA_DA_LISTA = Object.freeze({
  [TIPOS_LISTA.STATUS]: 'status',
  [TIPOS_LISTA.FONTE_LEAD]: 'fonte_lead',
  [TIPOS_LISTA.MOTIVO_PERDA]: 'motivo_perda',
  [TIPOS_LISTA.TAG]: 'tags',
});

/** Listas que o reconcile garante (tag começa vazia — nasce do uso). */
export const LISTAS_SEMEADAS = Object.freeze([
  TIPOS_LISTA.STATUS,
  TIPOS_LISTA.FONTE_LEAD,
  TIPOS_LISTA.MOTIVO_PERDA,
  TIPOS_LISTA.TIPO_ATIVIDADE,
]);

export const PADRAO_COR = /^#[0-9a-fA-F]{6}$/;

const COR_ABERTO = '#64748B';
const COR_GANHO = '#16A34A';
const COR_PERDIDO = '#DC2626';

/**
 * @typedef {{ key: string, label: string, color?: string | null, category?: string | null }} OpcaoPadrao
 */

/**
 * Opções de tenant que já tinha leads antes do M3: as MESMAS keys que os
 * CHECKs antigos aceitavam (migration 0009), pra nenhum lead mudar.
 *
 * @type {Readonly<Record<string, readonly OpcaoPadrao[]>>}
 */
export const OPCOES_LEGADAS = Object.freeze({
  [TIPOS_LISTA.STATUS]: [
    { key: 'novo', label: 'Novo', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'em_contato', label: 'Em contato', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'qualificado', label: 'Qualificado', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'proposta', label: 'Proposta', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'negociacao', label: 'Negociação', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'ganho', label: 'Ganho', color: COR_GANHO, category: CATEGORIAS_STATUS.GANHO },
    { key: 'perdido', label: 'Perdido', color: COR_PERDIDO, category: CATEGORIAS_STATUS.PERDIDO },
  ],
  [TIPOS_LISTA.FONTE_LEAD]: [
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'formulario_site', label: 'Formulário do site' },
    { key: 'indicacao', label: 'Indicação' },
    { key: 'trafego_pago', label: 'Tráfego pago' },
    { key: 'evento', label: 'Evento' },
    { key: 'importacao_manual', label: 'Importação manual' },
    { key: 'outro', label: 'Outro' },
  ],
  [TIPOS_LISTA.MOTIVO_PERDA]: [
    { key: 'preco', label: 'Preço' },
    { key: 'concorrente', label: 'Concorrente' },
    { key: 'sem_orcamento', label: 'Sem orçamento' },
    { key: 'sem_resposta', label: 'Sem resposta' },
    { key: 'fora_do_perfil', label: 'Fora do perfil' },
    { key: 'outro', label: 'Outro' },
  ],
});

/**
 * Padrões sugeridos pela spec (docs/crm/especificacao-configuracoes.md §3)
 * — só pra tenant sem nenhum lead quando a lista é semeada.
 *
 * @type {Readonly<Record<string, readonly OpcaoPadrao[]>>}
 */
export const OPCOES_SUGERIDAS = Object.freeze({
  [TIPOS_LISTA.STATUS]: [
    { key: 'novo', label: 'Novo', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'em_contato', label: 'Em contato', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'qualificado', label: 'Qualificado', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'proposta', label: 'Proposta', color: COR_ABERTO, category: CATEGORIAS_STATUS.ABERTO },
    { key: 'ganho', label: 'Ganho', color: COR_GANHO, category: CATEGORIAS_STATUS.GANHO },
    { key: 'perdido', label: 'Perdido', color: COR_PERDIDO, category: CATEGORIAS_STATUS.PERDIDO },
  ],
  [TIPOS_LISTA.FONTE_LEAD]: [
    { key: 'trafego_pago', label: 'Tráfego pago' },
    { key: 'organico', label: 'Orgânico' },
    { key: 'indicacao', label: 'Indicação' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'importacao', label: 'Importação' },
    { key: 'outro', label: 'Outro' },
  ],
  [TIPOS_LISTA.MOTIVO_PERDA]: [
    { key: 'orcamento', label: 'Orçamento' },
    { key: 'escolheu_concorrente', label: 'Escolheu concorrente' },
    { key: 'baixo_interesse', label: 'Baixo interesse' },
    { key: 'ciclo_longo', label: 'Ciclo longo' },
    { key: 'produto_incompativel', label: 'Produto incompatível' },
    { key: 'outro', label: 'Outro' },
  ],
  [TIPOS_LISTA.TIPO_ATIVIDADE]: [
    { key: 'ligacao', label: 'Ligação' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'reuniao', label: 'Reunião' },
    { key: 'email', label: 'E-mail' },
    { key: 'tarefa', label: 'Tarefa' },
    { key: 'visita', label: 'Visita' },
  ],
});
