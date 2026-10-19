/**
 * Enriquecimento por CNPJ (M11b, `docs/crm/plano-configuracoes.md`).
 */
import { TIPOS_CAMPO } from './campos.js';

export const CNPJ_FILA = 'crm-cnpj';

export const ENRIQUECIMENTO_CNPJ = Object.freeze({
  JOB: 'enriquecer',
  /** O dado da Receita muda pouco: 30 dias de cache global. */
  TTL_CACHE_DIAS: 30,
  TIMEOUT_PROVEDOR_MS: 5_000,
  TIMEOUT_ENFILEIRAR_MS: 5_000,
  /** Provedor fora do ar / 429: a fila tenta de novo, com espera crescente. */
  TENTATIVAS: 3,
  ESPERA_INICIAL_MS: 5_000,
  /** Rate limit padrão do worker por provedor (env `CNPJ_LIMITE_*` troca). */
  LIMITE_MAX: 3,
  LIMITE_JANELA_MS: 1_000,
});

export const MODOS_CNPJ = Object.freeze({ MANUAL: 'manual', AUTOMATICO: 'automatico' });

export const LISTA_MODOS_CNPJ = Object.freeze(Object.values(MODOS_CNPJ));

/** Resultado da consulta. `nao_suportado` (ex. CNPJ alfanumérico no provedor) não vai pro cache. */
export const STATUS_CNPJ = Object.freeze({
  OK: 'ok',
  NAO_ENCONTRADO: 'nao_encontrado',
  NAO_SUPORTADO: 'nao_suportado',
});

const TEXTO = [TIPOS_CAMPO.TEXTO, TIPOS_CAMPO.TEXTO_LONGO];

/**
 * Dados da Receita que podem ir pra um campo do lead, com os tipos de
 * campo que os aceitam. `endereco` é o endereço inteiro: objeto no tipo
 * `endereco`, uma linha em campo de texto.
 */
export const CAMPOS_RECEITA = Object.freeze({
  razaoSocial: { label: 'Razão social', tipos: TEXTO },
  nomeFantasia: { label: 'Nome fantasia', tipos: TEXTO },
  situacao: { label: 'Situação cadastral', tipos: TEXTO },
  cnae: { label: 'Atividade principal (CNAE)', tipos: TEXTO },
  endereco: { label: 'Endereço completo', tipos: [TIPOS_CAMPO.ENDERECO, ...TEXTO] },
  logradouro: { label: 'Logradouro', tipos: TEXTO },
  numero: { label: 'Número', tipos: TEXTO },
  complemento: { label: 'Complemento', tipos: TEXTO },
  bairro: { label: 'Bairro', tipos: TEXTO },
  municipio: { label: 'Município', tipos: TEXTO },
  uf: { label: 'UF', tipos: TEXTO },
  cep: { label: 'CEP', tipos: [TIPOS_CAMPO.CEP, ...TEXTO] },
  telefone: { label: 'Telefone', tipos: [TIPOS_CAMPO.TELEFONE, ...TEXTO] },
  email: { label: 'E-mail', tipos: [TIPOS_CAMPO.EMAIL, ...TEXTO] },
  dataAbertura: { label: 'Data de abertura', tipos: [TIPOS_CAMPO.DATA, ...TEXTO] },
});

export const CHAVES_RECEITA = Object.freeze(Object.keys(CAMPOS_RECEITA));

/**
 * Configuração de tenant que nunca salvou: ligado, modo manual (só a
 * lupa), sem sobrescrever. O mapeamento padrão é por `systemKey` — o
 * service troca pelo `id` do campo no tenant (campo oculto fica de fora).
 */
export const CONFIG_CNPJ_PADRAO = Object.freeze({
  ativo: true,
  modo: MODOS_CNPJ.MANUAL,
  sobrescrever: false,
  mapeamentoPorSistema: Object.freeze({
    razaoSocial: 'empresa',
    municipio: 'cidade',
    uf: 'uf',
    cep: 'cep',
    endereco: 'endereco',
  }),
});
