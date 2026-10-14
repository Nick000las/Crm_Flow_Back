import { ROLES } from '#shared/constants/index.js';

/**
 * Constantes do módulo CRM. `FIELD_DEFINITION_TIPOS` espelha o CHECK
 * constraint de `modulo_crm.tenant_lead_field_definitions.tipo`
 * (prisma/migrations/0008_crm_lead_field_definitions) — uma única fonte
 * pro service validar e pro schema Zod do controller reaproveitar, em vez
 * de repetir a lista dos 6 tipos em mais de um lugar.
 */
export const FIELD_DEFINITION_TIPOS = Object.freeze([
  'texto',
  'numero',
  'data',
  'booleano',
  'selecao',
  'selecao_multipla',
]);

export const TIPOS_COM_OPCOES = Object.freeze(['selecao', 'selecao_multipla']);

/**
 * Identificador de camada usado no shape `{ chave, label, tipo, camada, ... }`
 * devolvido por `listarCamposDoTenant` (leads.service.js) — evita literal
 * mágico 1/2/3 espalhado pelo service.
 */
export const CAMADA = Object.freeze({ CAMADA_1: 1, CAMADA_2: 2, CAMADA_3: 3 });

/**
 * Campos nativos de Camada 2 (docs/plano-crm-campos-hibridos.md) — chave
 * camelCase (usada em `leads.schema.js`/`CriarLeadInput`/`AtualizarLeadInput`,
 * mesmo padrão de `funilEstagioId` → `funil_estagio_id`) mapeada pra coluna
 * real de `modulo_crm.leads` (migration 0009). Única fonte tanto pro nome
 * de coluna quanto pra lista de colunas válidas — `CAMADA_2_COLUNAS`
 * deriva daqui, nunca duplicar a lista à mão em outro arquivo.
 */
export const CAMADA_2_CAMPOS = Object.freeze({
  empresa: 'empresa',
  cargo: 'cargo',
  cpf: 'cpf',
  cnpj: 'cnpj',
  cidade: 'cidade',
  uf: 'uf',
  cep: 'cep',
  endereco: 'endereco',
  campanhaUtm: 'campanha_utm',
  dataConversao: 'data_conversao',
  probabilidadeFechamento: 'probabilidade_fechamento',
  dataPrevistaFechamento: 'data_prevista_fechamento',
  motivoPerda: 'motivo_perda',
  leadScore: 'lead_score',
  proximoFollowup: 'proximo_followup',
});

/**
 * Colunas nativas de Camada 2 (nomes de coluna, snake_case) — usada por
 * `field-visibility.service.js` pra validar `coluna` antes de gravar em
 * `tenant_lead_field_visibility`, nunca aceitando string arbitrária do
 * cliente indo pra uma tabela de controle.
 */
export const CAMADA_2_COLUNAS = Object.freeze(Object.values(CAMADA_2_CAMPOS));

/**
 * Direção inversa de `CAMADA_2_CAMPOS` (coluna snake_case → chave
 * camelCase) — usada pelo service pra ler `input[chave]` a partir de uma
 * linha de `tenant_lead_field_visibility` (que guarda `coluna` em
 * snake_case, igual à coluna real de `modulo_crm.leads`).
 */
export const CAMADA_2_COLUNA_PARA_CAMPO = Object.freeze(
  Object.fromEntries(Object.entries(CAMADA_2_CAMPOS).map(([campo, coluna]) => [coluna, campo])),
);

/** Valores fechados de Camada 1 (CHECK constraints da migration 0009). */
export const STATUS_LEAD_VALORES = Object.freeze([
  'novo',
  'em_contato',
  'qualificado',
  'proposta',
  'negociacao',
  'ganho',
  'perdido',
]);

export const FONTE_LEAD_VALORES = Object.freeze([
  'whatsapp',
  'formulario_site',
  'indicacao',
  'trafego_pago',
  'evento',
  'importacao_manual',
  'outro',
]);

export const MOTIVO_PERDA_VALORES = Object.freeze([
  'preco',
  'concorrente',
  'sem_orcamento',
  'sem_resposta',
  'fora_do_perfil',
  'outro',
]);

/**
 * Label/tipo/opções por coluna de Camada 2 (chave snake_case, mesma de
 * `CAMADA_2_COLUNAS`/`tenant_lead_field_visibility.coluna`) — usado por
 * `listarCamposDoTenant` (leads.service.js) pra montar a seção "camada: 2"
 * de `GET /crm/leads/fields` no mesmo shape de `FieldDefinition`.
 */
export const CAMADA_2_METADADOS = Object.freeze({
  empresa: { label: 'Empresa', tipo: 'texto' },
  cargo: { label: 'Cargo', tipo: 'texto' },
  cpf: { label: 'CPF', tipo: 'texto' },
  cnpj: { label: 'CNPJ', tipo: 'texto' },
  cidade: { label: 'Cidade', tipo: 'texto' },
  uf: { label: 'UF', tipo: 'texto' },
  cep: { label: 'CEP', tipo: 'texto' },
  endereco: { label: 'Endereço', tipo: 'texto' },
  campanha_utm: { label: 'Campanha (UTM)', tipo: 'texto' },
  data_conversao: { label: 'Data de conversão', tipo: 'data' },
  probabilidade_fechamento: { label: 'Probabilidade de fechamento', tipo: 'numero' },
  data_prevista_fechamento: { label: 'Data prevista de fechamento', tipo: 'data' },
  motivo_perda: { label: 'Motivo da perda', tipo: 'selecao', opcoes: MOTIVO_PERDA_VALORES },
  lead_score: { label: 'Lead score', tipo: 'numero' },
  proximo_followup: { label: 'Próximo follow-up', tipo: 'data' },
});

/**
 * Metadado fixo de Camada 1 (docs/plano-crm-campos-hibridos.md), mesmo
 * shape que `FieldDefinition` (Camada 3) — usado por
 * `listarCamposDoTenant` (leads.service.js) pra montar a seção "camada: 1"
 * de `GET /crm/leads/fields`. Sem tabela: Camada 1 não varia por tenant.
 */
export const CAMPOS_CAMADA_1 = Object.freeze([
  { chave: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true, ordem: 0 },
  // obrigatoriedade real de email/telefone é "pelo menos um dos dois" —
  // não representável no `obrigatorio: boolean` de um campo isolado,
  // tratada à parte no service (validarEmailOuTelefone).
  { chave: 'email', label: 'E-mail', tipo: 'texto', obrigatorio: false, ordem: 1 },
  { chave: 'telefone', label: 'Telefone', tipo: 'texto', obrigatorio: false, ordem: 2 },
  { chave: 'fonteLead', label: 'Origem do lead', tipo: 'selecao', obrigatorio: false, ordem: 3, opcoes: FONTE_LEAD_VALORES },
  { chave: 'status', label: 'Status', tipo: 'selecao', obrigatorio: false, ordem: 4, opcoes: STATUS_LEAD_VALORES },
  { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', obrigatorio: false, ordem: 5, opcoes: null },
  { chave: 'ultimaInteracaoEm', label: 'Última interação', tipo: 'data', obrigatorio: false, ordem: 6 },
]);

/**
 * Chave camelCase → coluna real de Camada 1, espelho de `CAMADA_2_CAMPOS`.
 * Única fonte de nome de coluna que o filtro (`lead-filter.service.js`)
 * aceita interpolar via `Prisma.raw` — nunca texto vindo do cliente.
 */
export const CAMADA_1_CAMPOS = Object.freeze({
  nome: 'nome',
  email: 'email',
  telefone: 'telefone',
  fonteLead: 'fonte_lead',
  status: 'status',
  tags: 'tags',
  ultimaInteracaoEm: 'ultima_interacao_em',
});

/** Operadores aceitos em `filtros[].operador` de POST /crm/leads/search. */
export const FILTRO_OPERADORES = Object.freeze(['igual', 'contem', 'entre', 'e_um_dos', 'vazio', 'nao_vazio']);

/** Quais operadores fazem sentido pra cada tipo de campo. */
export const OPERADORES_POR_TIPO = Object.freeze({
  texto: ['igual', 'contem', 'e_um_dos', 'vazio', 'nao_vazio'],
  numero: ['igual', 'entre', 'vazio', 'nao_vazio'],
  data: ['igual', 'entre', 'vazio', 'nao_vazio'],
  booleano: ['igual', 'vazio', 'nao_vazio'],
  selecao: ['igual', 'e_um_dos', 'vazio', 'nao_vazio'],
  selecao_multipla: ['contem', 'e_um_dos', 'vazio', 'nao_vazio'],
});

export const BUSCA_LEADS = Object.freeze({
  TAMANHO_PADRAO: 50,
  TAMANHO_MAXIMO: 200,
  MAX_FILTROS: 20,
});

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
  /** Mínimo de dígitos de um telefone BR (fixo com DDD). */
  MIN_DIGITOS_TELEFONE: 10,
});

export const EXPORTACAO = Object.freeze({
  MAX_LINHAS: 10_000,
  NOME_ARQUIVO: 'leads.xlsx',
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

/**
 * Papéis que podem mexer na configuração do CRM (campos customizados,
 * visibilidade da Camada 2) e em import/export. OPERADOR fica com o CRUD de
 * leads, busca e views salvas.
 */
export const PAPEIS_GESTAO = Object.freeze([ROLES.DONO, ROLES.MASTER]);
