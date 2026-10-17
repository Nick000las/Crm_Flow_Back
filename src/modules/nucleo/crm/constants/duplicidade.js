/**
 * Duplicidade e mesclagem (M7, `docs/crm/plano-configuracoes.md`).
 */

export const ACOES_DUPLICIDADE = Object.freeze({
  AVISAR: 'warn',
  BLOQUEAR: 'block',
});

export const LISTA_ACOES_DUPLICIDADE = Object.freeze(Object.values(ACOES_DUPLICIDADE));

/**
 * Campos que têm regra de duplicidade: `campo` da regra → chave do lead
 * na API e coluna gerada com a chave normalizada (migration 0020). Nome de
 * coluna só sai daqui (texto fixo, nunca do cliente).
 */
export const CAMPOS_DUPLICIDADE = Object.freeze({
  email: { chave: 'email', coluna: 'dedup_email', label: 'E-mail' },
  telefone: { chave: 'telefone', coluna: 'dedup_telefone', label: 'Telefone' },
  cnpj: { chave: 'cnpj', coluna: 'dedup_cnpj', label: 'CNPJ' },
  cpf: { chave: 'cpf', coluna: 'dedup_cpf', label: 'CPF' },
});

export const LISTA_CAMPOS_DUPLICIDADE = Object.freeze(Object.keys(CAMPOS_DUPLICIDADE));

/** Tenant que nunca configurou (e o import com a flag desligada). */
export const REGRAS_DUPLICIDADE_PADRAO = Object.freeze([
  { campo: 'email', acao: ACOES_DUPLICIDADE.AVISAR, ativo: true },
  { campo: 'telefone', acao: ACOES_DUPLICIDADE.AVISAR, ativo: true },
  { campo: 'cnpj', acao: ACOES_DUPLICIDADE.AVISAR, ativo: false },
  { campo: 'cpf', acao: ACOES_DUPLICIDADE.AVISAR, ativo: false },
]);

/** Quantos possíveis duplicados no máximo voltam por checagem. */
export const LIMITE_CANDIDATOS_DUPLICIDADE = 5;

/** Ação do import pra linha duplicada (mesmos valores de `ESTRATEGIAS_DUPLICATA`). */
export const ACOES_IMPORT_DUPLICATA = Object.freeze({
  PULAR: 'pular',
  ATUALIZAR: 'atualizar',
  CRIAR: 'criar',
});
