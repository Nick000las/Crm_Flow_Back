/**
 * @file Ações que não gravam: não pegam lock nem publicam evento.
 */
import { ROLES } from '#shared/constants/index.js';

/** `Module.key` do Kanban (`tenant_modules.module_key`). */
export const MODULO_KANBAN = 'kanban_universal';

/**
 * Flags do Kanban: o prefixo é a `key` do módulo (`assertModule`). Declaradas
 * antes de existir o que elas ligam, para o catálogo do admin já as listar.
 * Ver `docs/produto/kanban.md`, M2 e M6.
 */
export const KANBAN_FEATURES = Object.freeze({
  QUADROS_ENTIDADE: 'kanban_universal.quadros_entidade',
  VINCULO_ENTIDADE: 'kanban_universal.vinculo_entidade',
});

/** Quem gerencia quadros e colunas e enxerga todos os quadros do tenant. */
export const PAPEIS_GESTAO_KANBAN = Object.freeze([ROLES.DONO, ROLES.MASTER]);

/** Tipos de quadro com card nativo (`boards.board_type`). */
export const TIPOS_QUADRO = Object.freeze(['projetos', 'postagens_agencia']);

/** Como o conteúdo do quadro é mantido: pelo Kanban ou por um provedor (M2). */
export const MODOS_QUADRO = Object.freeze({ NATIVO: 'nativo', ENTIDADE: 'entidade' });

/** Ações que o motor confere em `acoesPermitidas` antes de chamar o provedor. */
export const ACOES_CARD_ENTIDADE = Object.freeze({ MOVER: 'mover' });

export const QUADRO_ENTIDADE = Object.freeze({
  MAX_REFERENCIA: 200,
  MAX_CURSOR: 1000,
  MIN_LIMITE: 1,
  MAX_LIMITE: 100,
  LIMITE_PADRAO: 50,
});

/** Despacho de mudanças para quem está com um quadro de entidade aberto (M5). */
export const DESPACHO_DE_QUADROS = Object.freeze({
  INTERVALO_MS: 1000,
  LOTE: 200,
  /** Por rodada: o que sobrar fica para a próxima, sem segurar o processo. */
  MAX_LOTES: 5,
});

/** Vínculo de card de projeto com um registro de outro módulo (M6). */
export const VINCULO = Object.freeze({ MAX_CARDS_NA_ABA: 100, LOTE_VARREDURA: 200 });

/** Às 2h, antes da purga da lixeira do CRM (3h): mesclado passa para o principal antes de sumir. */
export const VARREDURA_VINCULOS = Object.freeze({
  FILA: 'kanban-manutencao',
  AGENDAMENTO_ID: 'kanban-varredura-vinculos',
  JOB: 'varrer-vinculos',
  CRON: '0 2 * * *',
  FUSO: 'America/Sao_Paulo',
});

/** Ações que não gravam: não pegam lock nem publicam evento. */
export const ACOES_DE_LEITURA = new Set([
  'report.get',
  'metrics.get',
  'board.get',
  'board.members',
  'card.get',
  'card.list',
  'comment.list',
  'members',
  'archive.list',
  'activity.list',
  'email.get',
]);
