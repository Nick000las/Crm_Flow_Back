import { CATEGORIAS_STATUS } from './listas.js';

/** `crm_pipeline.type`. */
export const TIPOS_PIPELINE = Object.freeze({ VENDAS: 'sales', ATENDIMENTO: 'service' });

export const PIPELINES = Object.freeze({
  /** Incluindo Vendas e Atendimento (D5). Fixo por enquanto, mas vai mudar. */
  LIMITE_POR_TENANT: 5,
  NOME_VENDAS: 'Vendas',
  NOME_ATENDIMENTO: 'Atendimento',
  /** Quem assume o atendimento criado pela venda: o responsável pela pessoa. */
  DONO_DO_ATENDIMENTO: 'person_owner',
});

const COR_ABERTO = '#3B82F6';
const COR_GANHO = '#22C55E';
const COR_PERDIDO = '#EF4444';

/**
 * Lista inicial do pipeline Atendimento. O primeiro é onde o card nasce quando
 * a venda é ganha (`auto_create_initial_status`). O dono edita em Configurações.
 */
export const STATUS_DO_ATENDIMENTO = Object.freeze([
  {
    key: 'aguardando',
    label: 'Aguardando início',
    color: COR_ABERTO,
    category: CATEGORIAS_STATUS.ABERTO,
  },
  {
    key: 'em_atendimento',
    label: 'Em atendimento',
    color: COR_ABERTO,
    category: CATEGORIAS_STATUS.ABERTO,
  },
  { key: 'concluido', label: 'Concluído', color: COR_GANHO, category: CATEGORIAS_STATUS.GANHO },
  { key: 'cancelado', label: 'Cancelado', color: COR_PERDIDO, category: CATEGORIAS_STATUS.PERDIDO },
]);
