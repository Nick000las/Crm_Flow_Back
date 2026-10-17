/**
 * Atividades e histórico do lead (M6, `docs/crm/plano-configuracoes.md`).
 */

/** Tipos de `crm_lead_event` (sem CHECK no banco: tipo novo não exige migration). */
export const TIPOS_EVENTO_LEAD = Object.freeze({
  CRIADO: 'criado',
  ATUALIZADO: 'atualizado',
  ARQUIVADO: 'arquivado',
  DESARQUIVADO: 'desarquivado',
  EXCLUIDO: 'excluido',
  RESTAURADO: 'restaurado',
  // M7: o lead recebeu os dados de outro (o descartado vai pra lixeira).
  MESCLADO: 'mesclado',
});

/**
 * Dados do lead que não são campos configuráveis, no diff do evento — a
 * mesma chave da API (`AtualizarLeadInput`) e a coluna de onde sai o valor.
 * A referência do layout (M4) é a mesma de `REFERENCIAS_FIXAS`.
 */
export const PROPRIEDADES_NO_HISTORICO = Object.freeze([
  { campo: 'valor', coluna: 'valor', ref: 'lead.valor' },
  { campo: 'funilEstagioId', coluna: 'funil_estagio_id', ref: 'lead.estagio', colunaNome: 'estagio_nome' },
  { campo: 'usuarioResponsavelId', coluna: 'usuario_responsavel_id', ref: 'lead.responsavel' },
]);

/** `campo` das entradas do diff de personalizado (o `campoId` diz qual). */
export const CAMPO_PERSONALIZADO_NO_DIFF = 'customFields';

export const LIMITES_ATIVIDADE = Object.freeze({
  TITULO: 200,
  NOTAS: 5000,
});

export const PAGINACAO_EVENTOS = Object.freeze({
  TAMANHO_PADRAO: 50,
  TAMANHO_MAXIMO: 200,
});
