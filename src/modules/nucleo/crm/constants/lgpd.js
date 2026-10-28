/**
 * Base legal LGPD (M15, `docs/crm/plano-configuracoes.md`). Os quatro
 * campos são do sistema (Camada 2, `constants/campos.js`); valores fixos
 * (categorias da lei, CHECK no banco), não lista do tenant.
 */

export const BASES_LEGAIS = Object.freeze({
  CONSENTIMENTO: 'consentimento',
  LEGITIMO_INTERESSE: 'legitimo_interesse',
  EXECUCAO_CONTRATO: 'execucao_contrato',
  OBRIGACAO_LEGAL: 'obrigacao_legal',
  OUTRA: 'outra',
});

export const OPCOES_BASE_LEGAL = Object.freeze([
  Object.freeze({ key: BASES_LEGAIS.CONSENTIMENTO, label: 'Consentimento' }),
  Object.freeze({ key: BASES_LEGAIS.LEGITIMO_INTERESSE, label: 'Legítimo interesse' }),
  Object.freeze({ key: BASES_LEGAIS.EXECUCAO_CONTRATO, label: 'Execução de contrato' }),
  Object.freeze({ key: BASES_LEGAIS.OBRIGACAO_LEGAL, label: 'Obrigação legal' }),
  Object.freeze({ key: BASES_LEGAIS.OUTRA, label: 'Outra' }),
]);

export const LISTA_BASES_LEGAIS = Object.freeze(OPCOES_BASE_LEGAL.map((opcao) => opcao.key));

/**
 * Por onde o lead entrou — gravada pelo back, só leitura. `formulario`,
 * `whatsapp` e `api` ficam reservadas pros canais que ainda não existem.
 */
export const ORIGENS_REGISTRO = Object.freeze({
  FORMULARIO: 'formulario',
  IMPORTACAO: 'importacao',
  WHATSAPP: 'whatsapp',
  MANUAL: 'manual',
  API: 'api',
});

export const OPCOES_ORIGEM_REGISTRO = Object.freeze([
  Object.freeze({ key: ORIGENS_REGISTRO.FORMULARIO, label: 'Formulário' }),
  Object.freeze({ key: ORIGENS_REGISTRO.IMPORTACAO, label: 'Importação' }),
  Object.freeze({ key: ORIGENS_REGISTRO.WHATSAPP, label: 'WhatsApp' }),
  Object.freeze({ key: ORIGENS_REGISTRO.MANUAL, label: 'Manual' }),
  Object.freeze({ key: ORIGENS_REGISTRO.API, label: 'API' }),
]);

/** Chaves da API dos campos LGPD. */
export const CAMPOS_LGPD = Object.freeze({
  BASE_LEGAL: 'baseLegal',
  BASE_LEGAL_EM: 'baseLegalEm',
  ORIGEM_REGISTRO: 'origemRegistro',
  OPT_OUT_EM: 'optOutMarketingEm',
  /** Só no payload (sim/não): o back carimba `optOutMarketingEm`. */
  OPT_OUT: 'optOutMarketing',
});

/**
 * Anonimização (pedido do titular). O lead fica pras estatísticas (status,
 * estágio, valor, origem, score, datas, responsável, cidade/UF, tags); sai
 * o que identifica a pessoa.
 */
export const ANONIMIZACAO = Object.freeze({
  NOME: 'Lead anonimizado',
  TITULO_ATIVIDADE: 'Atividade anonimizada',
  /** Colunas apagadas do lead (nome vira `NOME`). */
  COLUNAS_PII: Object.freeze(['primeiro_nome', 'email', 'telefone', 'empresa', 'cargo', 'cpf', 'cnpj', 'endereco', 'cep']),
  /** Chaves da API cujo antes/depois some do histórico. */
  CHAVES_PII: Object.freeze(['nome', 'primeiroNome', 'email', 'telefone', 'empresa', 'cargo', 'cpf', 'cnpj', 'endereco', 'cep']),
  /** Personalizados que ficam (não identificam a pessoa); os outros tipos são apagados. */
  TIPOS_PERSONALIZADO_MANTIDOS: Object.freeze([
    'numero', 'monetario', 'data', 'booleano', 'selecao', 'selecao_multipla', 'usuario', 'intervalo_datas', 'hora',
  ]),
  /** Chaves de `detalhes` do evento que guardam dado pessoal (nome do mesclado, CNPJ consultado). */
  DETALHES_PII: Object.freeze(['nomeDescartado', 'cnpj']),
  /** `audit_log.acao` (core, append-only). */
  ACAO_AUDITORIA: 'crm.lead_anonimizado',
  ENTIDADE_AUDITORIA: 'lead',
  /** GUC que o trigger do histórico respeita (migration 0028). */
  GUC: 'app.lgpd_anonimizando',
});
