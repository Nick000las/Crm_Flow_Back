import { TIPOS_CAMPO } from './campos.js';

/**
 * Formulários (FM1, docs/crm/plano-execucao-formularios-forecast.md).
 *
 * O formulário junta campos da pessoa que já existem no CRM (decisão do dono,
 * 07/11/2026) e perguntas próprias, cuja resposta fica só na resposta do
 * formulário (revisão do dono, FM2b). O dono marca quais campos vêm
 * pré-preenchidos; campo sensível nunca vem.
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

/**
 * Tipos de pergunta própria: os do CRM, menos usuário (quem responde de fora
 * não conhece a equipe) e endereço (é um campo composto da pessoa: use o
 * campo Endereço). Arquivo só na FM7.
 */
export const TIPOS_PERGUNTA = Object.freeze(
  Object.values(TIPOS_CAMPO).filter(
    (tipo) => tipo !== TIPOS_CAMPO.USUARIO && tipo !== TIPOS_CAMPO.ENDERECO,
  ),
);

/** Tipos de pergunta que exigem a lista de opções. */
export const TIPOS_PERGUNTA_COM_OPCOES = Object.freeze([
  TIPOS_CAMPO.SELECAO,
  TIPOS_CAMPO.SELECAO_MULTIPLA,
]);

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
  ROTULO_PERGUNTA: 200,
  AJUDA_PERGUNTA: 500,
  OPCOES_PERGUNTA: 50,
  OPCAO_PERGUNTA: 120,
  VALIDADE_PADRAO_DIAS: 7,
  VALIDADE_MIN_DIAS: 1,
  VALIDADE_MAX_DIAS: 90,
});

/** `crm_form_link.status`. `expired` também é derivado na leitura por `expires_at`. */
export const STATUS_LINK = Object.freeze({
  ATIVO: 'active',
  RESPONDIDO: 'submitted',
  EXPIRADO: 'expired',
  REVOGADO: 'revoked',
});

/** `crm_event.entidade` do link. O despacho do quadro confirma sem aviso. */
export const ENTIDADE_LINK_FORMULARIO = 'form_link';

/** `crm_event.tipo`. Payload só com ids. */
export const EVENTOS_FORMULARIO = Object.freeze({
  LINK_CRIADO: 'form.link_created',
  LINK_REVOGADO: 'form.link_revoked',
});

/** Caminho da página pública no front: `${FRONTEND_URL}/f/<token>`. */
export const CAMINHO_PUBLICO_DO_FORMULARIO = '/f/';

/**
 * Página pública (FM3). O token é base64url de 32 bytes: 43 caracteres.
 * Qualquer outra forma é recusada antes de ir ao banco.
 */
export const FORMATO_TOKEN_LINK = /^[A-Za-z0-9_-]{43}$/;

/** Limite por link, somado ao limite por IP de todo `/public`. */
export const LIMITE_POR_LINK = Object.freeze({ MAX: 30, JANELA: '1 minute' });

/** Caminho das rotas públicas do formulário, dentro de `/public`. */
export const ROTA_PUBLICA_FORMULARIO = '/f/:token';
