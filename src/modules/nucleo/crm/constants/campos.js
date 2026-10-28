/**
 * Campos do CRM. `FIELD_DEFINITION_TIPOS` são os tipos aceitos
 * em campo personalizado (`crm_field.type`, sem CHECK no banco — os tipos
 * crescem por marco) — uma única fonte pro service validar e pro schema
 * Zod do controller reaproveitar.
 * Como cada tipo valida, normaliza e converte mora em
 * `services/tipos-campo.service.js`.
 */
import { OPCOES_BASE_LEGAL, OPCOES_ORIGEM_REGISTRO } from './lgpd.js';
import { TIPOS_LISTA } from './listas.js';

export const TIPOS_CAMPO = Object.freeze({
  TEXTO: 'texto',
  TEXTO_LONGO: 'texto_longo',
  NUMERO: 'numero',
  MONETARIO: 'monetario',
  DATA: 'data',
  BOOLEANO: 'booleano',
  SELECAO: 'selecao',
  SELECAO_MULTIPLA: 'selecao_multipla',
  TELEFONE: 'telefone',
  EMAIL: 'email',
  URL: 'url',
  // M11: documentos, endereço, usuário, intervalo e hora.
  CPF: 'cpf',
  CNPJ: 'cnpj',
  CEP: 'cep',
  ENDERECO: 'endereco',
  USUARIO: 'usuario',
  INTERVALO_DATAS: 'intervalo_datas',
  HORA: 'hora',
});

/**
 * Partes do tipo `endereco` (M11), nesta ordem — a ordem fixa das chaves
 * evita diff falso no histórico (que compara por JSON).
 */
export const PARTES_ENDERECO = Object.freeze(['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']);

/** Tamanho da UF no endereço. */
export const TAMANHO_UF = 2;

export const FIELD_DEFINITION_TIPOS = Object.freeze(Object.values(TIPOS_CAMPO));

export const TIPOS_COM_OPCOES = Object.freeze(['selecao', 'selecao_multipla']);

/**
 * Identificador de camada usado no shape `{ chave, label, tipo, camada, ... }`
 * devolvido por `listarCamposDoTenant` (leads.service.js) — evita literal
 * mágico 1/2/3 espalhado pelo service.
 */
export const CAMADA = Object.freeze({ CAMADA_1: 1, CAMADA_2: 2, CAMADA_3: 3 });

/**
 * Campos nativos de Camada 2 (docs/crm/plano-campos-hibridos.md) — chave
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
  // M15 (LGPD): base legal escolhida; data, origem e opt-out carimbados pelo back.
  baseLegal: 'legal_basis',
  baseLegalEm: 'legal_basis_at',
  origemRegistro: 'origem_registro',
  optOutMarketingEm: 'marketing_opt_out_at',
});

/**
 * Colunas nativas de Camada 2 (nomes de coluna, snake_case) — usada por
 * o resolver de campos pra mapear coluna ↔ `system_key` em `crm_field`,
 * nunca aceitando string arbitrária do
 * cliente indo pra uma tabela de controle.
 */
export const CAMADA_2_COLUNAS = Object.freeze(Object.values(CAMADA_2_CAMPOS));

/**
 * Direção inversa de `CAMADA_2_CAMPOS` (coluna snake_case → chave
 * camelCase) — usada pelo service pra ler `input[chave]` a partir de uma
 * coluna da Camada 2 (que vem em
 * snake_case, igual à coluna real de `modulo_crm.leads`).
 */
export const CAMADA_2_COLUNA_PARA_CAMPO = Object.freeze(
  Object.fromEntries(Object.entries(CAMADA_2_CAMPOS).map(([campo, coluna]) => [coluna, campo])),
);

/**
 * Opções fixas de um campo do sistema no mesmo shape das de lista
 * (`opcoes` = keys aceitas, `opcoesLista` = com label pra tela).
 *
 * @param {readonly { key: string, label: string }[]} opcoes
 */
function opcoesFixas(opcoes) {
  return {
    opcoes: opcoes.map((opcao) => opcao.key),
    opcoesLista: opcoes.map(({ key, label }) => ({ key, label, color: null, category: null, ativo: true })),
  };
}

/**
 * Label/tipo/opções por coluna de Camada 2 (chave snake_case, mesma de
 * `CAMADA_2_COLUNAS`) — usado por
 * `listarCamposDoTenant` (leads.service.js) pra montar a seção "camada: 2"
 * de `GET /crm/leads/fields` no mesmo shape de `FieldDefinition`.
 */
export const CAMADA_2_METADADOS = Object.freeze({
  empresa: { label: 'Empresa', tipo: 'texto' },
  cargo: { label: 'Cargo', tipo: 'texto' },
  // M11: tipos de documento (validados e gravados normalizados nas escritas
  // novas; lead antigo com máscara fica como está até ser editado).
  cpf: { label: 'CPF', tipo: 'cpf' },
  cnpj: { label: 'CNPJ', tipo: 'cnpj' },
  cidade: { label: 'Cidade', tipo: 'texto' },
  uf: { label: 'UF', tipo: 'texto' },
  cep: { label: 'CEP', tipo: 'cep' },
  endereco: { label: 'Endereço', tipo: 'texto' },
  campanha_utm: { label: 'Campanha (UTM)', tipo: 'texto' },
  data_conversao: { label: 'Data de conversão', tipo: 'data' },
  probabilidade_fechamento: { label: 'Probabilidade de fechamento', tipo: 'numero' },
  data_prevista_fechamento: { label: 'Data prevista de fechamento', tipo: 'data' },
  motivo_perda: { label: 'Motivo da perda', tipo: 'selecao', lista: TIPOS_LISTA.MOTIVO_PERDA },
  lead_score: { label: 'Lead score', tipo: 'numero' },
  proximo_followup: { label: 'Próximo follow-up', tipo: 'data' },
  // M15: opções fixas (categorias da lei, não lista do tenant); `somenteLeitura`
  // = o back grava, o payload não muda (o front trava no formulário).
  legal_basis: { label: 'Base legal', tipo: 'selecao', ...opcoesFixas(OPCOES_BASE_LEGAL) },
  legal_basis_at: { label: 'Data da base legal', tipo: 'data', somenteLeitura: true },
  origem_registro: { label: 'Origem do registro', tipo: 'selecao', ...opcoesFixas(OPCOES_ORIGEM_REGISTRO), somenteLeitura: true },
  marketing_opt_out_at: { label: 'Opt-out de marketing', tipo: 'data', somenteLeitura: true },
});

/**
 * Metadado fixo de Camada 1 (docs/crm/plano-campos-hibridos.md), mesmo
 * shape que `FieldDefinition` (Camada 3) — usado por
 * `listarCamposDoTenant` (leads.service.js) pra montar a seção "camada: 1"
 * de `GET /crm/leads/fields`. Sem tabela: Camada 1 não varia por tenant.
 */
export const CAMPOS_CAMADA_1 = Object.freeze([
  { chave: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true, ordem: 0 },
  // obrigatoriedade real de email/telefone é "pelo menos um dos dois" —
  // não representável no `obrigatorio: boolean` de um campo isolado,
  // tratada à parte no service (validarEmailOuTelefone).
  // Tipos `email`/`telefone` (os mesmos do personalizado): gravados na
  // forma canônica e comparados nela no filtro (tipos-campo.service.js).
  { chave: 'email', label: 'E-mail', tipo: TIPOS_CAMPO.EMAIL, obrigatorio: false, ordem: 1 },
  { chave: 'telefone', label: 'Telefone', tipo: TIPOS_CAMPO.TELEFONE, obrigatorio: false, ordem: 2 },
  // Opções vêm da lista configurável (M3, `crm_option`), não do código.
  { chave: 'fonteLead', label: 'Origem do lead', tipo: 'selecao', obrigatorio: false, ordem: 3, lista: TIPOS_LISTA.FONTE_LEAD },
  { chave: 'status', label: 'Status', tipo: 'selecao', obrigatorio: false, ordem: 4, lista: TIPOS_LISTA.STATUS },
  { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', obrigatorio: false, ordem: 5, lista: TIPOS_LISTA.TAG },
  { chave: 'ultimaInteracaoEm', label: 'Última interação', tipo: 'data', obrigatorio: false, ordem: 6 },
  // M10: derivado do Nome (primeira palavra) e editável — personaliza
  // mensagens. No fim da lista pra não mexer na ordem padrão dos outros.
  { chave: 'primeiroNome', label: 'Primeiro nome', tipo: 'texto', obrigatorio: false, ordem: 7 },
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
  primeiroNome: 'primeiro_nome',
});

/**
 * O que o tenant pode mudar em cada campo do sistema (M1,
 * docs/crm/plano-configuracoes.md). Validado no back — a UI só reflete.
 * Identidade e contato (`nome`/`email`/`telefone`) e `status` (base do
 * funil e das regras por categoria) nunca somem; o resto da Camada 1 pode
 * ser ocultado por contexto (M2). `email`/`telefone` não viram
 * "obrigatório" isoladamente porque a regra é "pelo menos um dos dois", e
 * `nome` é sempre obrigatório.
 */
const CAPACIDADES_CAMADA_1 = Object.freeze({
  nome: { canHide: false, canMakeOptional: false, canRename: true },
  email: { canHide: false, canMakeOptional: false, canRename: true },
  telefone: { canHide: false, canMakeOptional: false, canRename: true },
  fonteLead: { canHide: true, canMakeOptional: true, canRename: true },
  status: { canHide: false, canMakeOptional: true, canRename: true },
  tags: { canHide: true, canMakeOptional: true, canRename: true },
  ultimaInteracaoEm: { canHide: true, canMakeOptional: true, canRename: true },
  primeiroNome: { canHide: true, canMakeOptional: true, canRename: true },
});

/** Personalizado: o tenant criou, o tenant decide tudo. */
export const CAPACIDADES_PERSONALIZADO = Object.freeze({ canHide: true, canMakeOptional: true, canRename: true });

const CAPACIDADES_CAMADA_2 = Object.freeze({ canHide: true, canMakeOptional: true, canRename: true });

/**
 * Contrato dos campos do sistema (Camadas 1 e 2): a constante continua
 * sendo a fonte da verdade de coluna, tipo e capacidades; `crm_field`
 * guarda só a configuração por tenant (label, posição, obrigatoriedade,
 * visibilidade). `systemKey` = a `chave` camelCase da API. Derivado das
 * constantes de camada acima — nunca duplicar a lista à mão.
 *
 * `ordemPadrao` = posição na lista (Camada 1, depois Camada 2): é a ordem
 * de um tenant novo e a do "voltar ao padrão" da área Configurações.
 *
 * @typedef {{
 *   systemKey: string, coluna: string, label: string, tipo: string,
 *   lista: string | null, camada: 1 | 2,
 *   ordemPadrao: number, obrigatorioPadrao: boolean, visivelPadrao: boolean,
 *   canHide: boolean, canMakeOptional: boolean, canRename: boolean,
 *   opcoes?: readonly string[], somenteLeitura?: boolean,
 * }} CampoSistema
 * @type {readonly CampoSistema[]}
 */
export const CAMPOS_SISTEMA = Object.freeze([
  ...CAMPOS_CAMADA_1.map((campo) => ({
    systemKey: campo.chave,
    coluna: CAMADA_1_CAMPOS[campo.chave],
    label: campo.label,
    tipo: campo.tipo,
    lista: campo.lista ?? null,
    camada: CAMADA.CAMADA_1,
    ordemPadrao: campo.ordem,
    obrigatorioPadrao: campo.obrigatorio,
    visivelPadrao: true,
    ...CAPACIDADES_CAMADA_1[campo.chave],
  })),
  ...CAMADA_2_COLUNAS.map((coluna, indice) => ({
    systemKey: CAMADA_2_COLUNA_PARA_CAMPO[coluna],
    coluna,
    label: CAMADA_2_METADADOS[coluna].label,
    tipo: CAMADA_2_METADADOS[coluna].tipo,
    lista: CAMADA_2_METADADOS[coluna].lista ?? null,
    // M15: opções fixas e "só leitura" (os campos LGPD carimbados pelo back).
    ...(CAMADA_2_METADADOS[coluna].opcoes ? { opcoes: CAMADA_2_METADADOS[coluna].opcoes } : {}),
    ...(CAMADA_2_METADADOS[coluna].somenteLeitura ? { somenteLeitura: true } : {}),
    camada: CAMADA.CAMADA_2,
    ordemPadrao: CAMPOS_CAMADA_1.length + indice,
    obrigatorioPadrao: false,
    visivelPadrao: false,
    ...CAPACIDADES_CAMADA_2,
  })),
]);

/**
 * Contextos de visibilidade (`crm_field_visibility.context`), contexto como
 * linha: contexto novo não exige migration. Em M1 os quatro andam juntos
 * (espelho do `visivel` antigo); M2 os separa.
 */
export const CONTEXTOS_VISIBILIDADE = Object.freeze({
  CRIACAO: 'create_form',
  FICHA: 'detail',
  TABELA: 'table',
  FILTRO: 'filter',
});

export const LISTA_CONTEXTOS_VISIBILIDADE = Object.freeze(Object.values(CONTEXTOS_VISIBILIDADE));

/** Operadores aceitos em `filtros[].operador` de POST /crm/leads/search. */
export const FILTRO_OPERADORES = Object.freeze(['igual', 'contem', 'entre', 'e_um_dos', 'vazio', 'nao_vazio']);

/** Quais operadores fazem sentido pra cada tipo de campo. */
export const OPERADORES_POR_TIPO = Object.freeze({
  texto: ['igual', 'contem', 'e_um_dos', 'vazio', 'nao_vazio'],
  texto_longo: ['contem', 'vazio', 'nao_vazio'],
  numero: ['igual', 'entre', 'vazio', 'nao_vazio'],
  monetario: ['igual', 'entre', 'vazio', 'nao_vazio'],
  data: ['igual', 'entre', 'vazio', 'nao_vazio'],
  booleano: ['igual', 'vazio', 'nao_vazio'],
  selecao: ['igual', 'e_um_dos', 'vazio', 'nao_vazio'],
  selecao_multipla: ['contem', 'e_um_dos', 'vazio', 'nao_vazio'],
  telefone: ['igual', 'contem', 'vazio', 'nao_vazio'],
  email: ['igual', 'contem', 'e_um_dos', 'vazio', 'nao_vazio'],
  url: ['igual', 'contem', 'vazio', 'nao_vazio'],
  cpf: ['igual', 'contem', 'vazio', 'nao_vazio'],
  cnpj: ['igual', 'contem', 'vazio', 'nao_vazio'],
  cep: ['igual', 'contem', 'vazio', 'nao_vazio'],
  endereco: ['contem', 'vazio', 'nao_vazio'],
  usuario: ['igual', 'e_um_dos', 'vazio', 'nao_vazio'],
  // `entre` no intervalo = os dois intervalos se sobrepõem.
  intervalo_datas: ['entre', 'vazio', 'nao_vazio'],
  hora: ['igual', 'entre', 'vazio', 'nao_vazio'],
});

export const BUSCA_LEADS = Object.freeze({
  TAMANHO_PADRAO: 50,
  TAMANHO_MAXIMO: 200,
  MAX_FILTROS: 20,
});

/**
 * Edição em massa (M10, `PATCH /crm/leads/bulk`): o mesmo teto da página
 * da busca — o front marca os leads dentro de uma página.
 */
export const EDICAO_EM_MASSA = Object.freeze({
  MAX_LEADS: 200,
});
