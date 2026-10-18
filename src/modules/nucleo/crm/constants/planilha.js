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

/**
 * Colunas que só o export conhece (M10): as referências fixas do layout
 * que não são mapeáveis no import. Com elas, as colunas padrão (as da
 * tabela do usuário) saem inteiras.
 */
export const CAMPOS_SO_EXPORTACAO = Object.freeze([
  { chave: 'usuarioResponsavelId', label: 'Responsável', tipo: 'texto', obrigatorio: false },
  { chave: 'createdAt', label: 'Criado em', tipo: 'data', obrigatorio: false },
]);

export const FORMATOS_EXPORTACAO = Object.freeze({ XLSX: 'xlsx', CSV: 'csv' });

export const LISTA_FORMATOS_EXPORTACAO = Object.freeze(Object.values(FORMATOS_EXPORTACAO));

export const EXPORTACAO = Object.freeze({
  MAX_LINHAS: 10_000,
  NOME_ARQUIVO: 'leads.xlsx',
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // CSV pro Excel pt-BR (M10): `;` (a vírgula é o decimal), BOM pra ele
  // ler UTF-8 (acentos) e CRLF.
  NOME_ARQUIVO_CSV: 'leads.csv',
  CONTENT_TYPE_CSV: 'text/csv; charset=utf-8',
  CSV_SEPARADOR: ';',
  CSV_QUEBRA_LINHA: '\r\n',
  CSV_BOM: '﻿',
});
