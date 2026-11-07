import { TIPOS_CAMPO } from './campos.js';

/**
 * Formulários (FM1, docs/crm/plano-execucao-formularios-forecast.md).
 *
 * O formulário é uma seleção de campos da pessoa que já existem no CRM
 * (decisão do dono, 07/11/2026). Pergunta nova vira campo personalizado.
 */

/**
 * Campos do sistema que a pessoa pode responder. Ficam de fora os que o
 * sistema preenche (origem, tags, score, LGPD, primeiro nome, UTM), os da
 * equipe (follow-up, última interação) e os da oportunidade (status, valor,
 * motivo, previsão, probabilidade, conversão).
 */
export const CHAVES_SISTEMA_DO_FORMULARIO = Object.freeze([
  'nome',
  'email',
  'telefone',
  'empresa',
  'cargo',
  'cpf',
  'cnpj',
  'cidade',
  'uf',
  'cep',
  'endereco',
]);

/** Personalizado que quem responde de fora não sabe preencher. */
export const TIPOS_FORA_DO_FORMULARIO = Object.freeze([TIPOS_CAMPO.USUARIO]);

/** O que a resposta faz com o valor que a pessoa já tem. */
export const POLITICAS_ESCRITA = Object.freeze({
  /** A declaração mais recente vale (padrão das perguntas). */
  SOBRESCREVER: 'overwrite',
  /** Só grava se estiver vazio; se divergir, vai para revisão. */
  PREENCHER_SE_VAZIO: 'fill_if_empty',
});

export const LISTA_POLITICAS_ESCRITA = Object.freeze(Object.values(POLITICAS_ESCRITA));

/** Contato e documento não são sobrescritos por padrão. */
export const CHAVES_PREENCHER_SE_VAZIO = Object.freeze(['email', 'telefone', 'cpf', 'cnpj']);

export const LIMITES_FORMULARIO = Object.freeze({
  POR_TENANT: 50,
  SECOES: 20,
  ITENS: 100,
  NOME: 120,
  DESCRICAO: 500,
  TITULO_SECAO: 120,
  INTRODUCAO: 2000,
  TERMO: 10_000,
  VALIDADE_PADRAO_DIAS: 7,
  VALIDADE_MIN_DIAS: 1,
  VALIDADE_MAX_DIAS: 90,
});
