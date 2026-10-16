/**
 * Colunas de planilha que não são "campos" do formulário (não estão em
 * `GET /crm/leads/fields`) mas fazem sentido em import/export: `valor` e
 * o estágio do funil pelo nome (no import, casado contra
 * `modulo_crm.funil_estagios.nome` do tenant).
 */
export const CAMPOS_EXTRAS_PLANILHA = Object.freeze([
  { chave: 'valor', label: 'Valor', tipo: 'numero', obrigatorio: false },
  { chave: 'funilEstagio', label: 'Estágio do funil', tipo: 'texto', obrigatorio: false },
]);

export const ESTRATEGIAS_DUPLICATA = Object.freeze(['pular', 'atualizar', 'criar']);

/** Espelha o CHECK de `modulo_crm.import_jobs.status` (migration 0010). */
export const IMPORT_JOB_STATUS = Object.freeze({
  PENDENTE: 'pendente',
  PROCESSANDO: 'processando',
  CONCLUIDO: 'concluido',
  FALHOU: 'falhou',
});

export const IMPORT_FILA = 'crm-import';

export const IMPORTACAO = Object.freeze({
  MAX_LINHAS: 5_000,
  LINHAS_PREVIEW: 10,
  /** De quantas em quantas linhas o worker grava progresso no job. */
  LOTE_PROGRESSO: 50,
  /** Primeira linha de dado da planilha (linha 1 é o cabeçalho). */
  PRIMEIRA_LINHA_DADOS: 2,
  TAMANHO_MAXIMO_ARQUIVO_BYTES: 10 * 1024 * 1024,
  TIMEOUT_ENFILEIRAR_MS: 5_000,
});

export const EXPORTACAO = Object.freeze({
  MAX_LINHAS: 10_000,
  NOME_ARQUIVO: 'leads.xlsx',
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});
