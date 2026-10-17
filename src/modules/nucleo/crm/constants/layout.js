/**
 * Layout do lead (docs/crm/plano-configuracoes.md, M4): identificador,
 * subtítulo, destaques, seções do drawer e colunas padrão da tabela.
 *
 * Cada item do layout é uma "referência": o `id` de um campo em
 * `crm_field` (sistema ou personalizado) ou uma das referências fixas
 * abaixo — dados do lead que não são campos configuráveis.
 */
export const LIMITES_LAYOUT = Object.freeze({
  SUBTITULO: 2,
  DESTAQUES: 4,
  SECOES: 12,
  NOME_SECAO: 60,
});

/** Propriedades de lista que o override mescla com o padrão (regra do HubSpot). */
export const LISTAS_MESCLADAS = Object.freeze(['subtitulo', 'destaques', 'colunas']);

export const PROPRIEDADES_LAYOUT = Object.freeze(['identificador', 'subtitulo', 'destaques', 'secoes', 'colunas']);

/**
 * Referências fixas: `coluna` é a propriedade do lead lido
 * (`leads.repository.js`, `COLUNAS_LEITURA`).
 */
export const REFERENCIAS_FIXAS = Object.freeze({
  'lead.valor': { chave: 'valor', label: 'Valor', tipo: 'monetario', coluna: 'valor' },
  'lead.responsavel': { chave: 'usuarioResponsavelId', label: 'Responsável', tipo: 'usuario', coluna: 'usuario_responsavel_id' },
  'lead.estagio': { chave: 'funilEstagio', label: 'Estágio do funil', tipo: 'texto', coluna: 'estagio_nome' },
  'lead.criadoEm': { chave: 'createdAt', label: 'Criado em', tipo: 'data', coluna: 'created_at' },
});

/**
 * Campos do sistema que podem ser o identificador (spec §1). Personalizado
 * pode, se for de texto.
 */
export const IDENTIFICADORES_DO_SISTEMA = Object.freeze(['nome', 'empresa', 'cnpj', 'cpf', 'email']);

/** Identificador que é documento: a busca compara só os dígitos. */
export const IDENTIFICADORES_NUMERICOS = Object.freeze(['cnpj', 'cpf']);

export const NOME_SECAO_UNICA = 'Dados do lead';
export const NOME_SECAO_OUTROS = 'Outros campos';

/**
 * Layout de tenant que nunca configurou, por `systemKey` (o service troca
 * pelo `id` do campo no tenant) ou referência fixa. Sem seções: tudo numa
 * seção só.
 */
export const LAYOUT_INICIAL = Object.freeze({
  identificador: 'nome',
  subtitulo: ['email', 'telefone'],
  destaques: ['lead.valor', 'status', 'lead.responsavel'],
  secoes: [],
  colunas: ['telefone', 'email', 'status', 'fonteLead', 'lead.valor', 'lead.responsavel', 'lead.criadoEm'],
});
