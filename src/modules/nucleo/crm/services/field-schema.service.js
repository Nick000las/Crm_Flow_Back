import { cacheDel, lerComCache } from '#core/cache/cache.js';
import { buscarCamposDoTenant } from '../adapters/crm-fields.repository.js';
import { buscarOpcoesDoTenant } from '../adapters/crm-options.repository.js';
import {
  CAMADA,
  CAMADA_1_CAMPOS,
  CAMADA_2_COLUNAS,
  CAMADA_2_COLUNA_PARA_CAMPO,
  CAMADA_2_METADADOS,
  CAMPOS_CAMADA_1,
  CAMPOS_SISTEMA,
  CONTEXTOS_VISIBILIDADE,
  LISTA_CONTEXTOS_VISIBILIDADE,
  LISTAS_SEMEADAS,
  TIPOS_LISTA,
} from '../constants.js';
import { reconciliarCampos } from './campos-reconcile.service.js';
import { reconciliarListas } from './listas-reconcile.service.js';

/**
 * Resolver do schema efetivo de campos (docs/crm/plano-configuracoes.md,
 * M1.4): fonte ÚNICA de metadado pra formulário, tabela, filtro, import,
 * export e validação. Lê `crm_field` (+ visibilidade por contexto),
 * semeando os campos do sistema na hora se o tenant ainda não os tiver.
 * Nenhum consumidor lê a configuração direto do banco.
 *
 * A API fala `chave` (estável e legível); `custom_fields` é gravado por
 * `id` do campo (decisão D2) — as funções `customFieldsPara*` traduzem.
 *
 * @typedef {import('../types/index.js').FieldVisibility} FieldVisibility
 * @typedef {import('../types/index.js').FieldDefinition} FieldDefinition
 * @typedef {Record<string, boolean>} VisibilidadePorContexto  `{ create_form, detail, table, filter }`
 * @typedef {{ id?: string, label?: string, obrigatorio?: boolean, ordem?: number, visibilidade?: VisibilidadePorContexto }} Sobreposicao
 *   o que a configuração do tenant muda num campo, por `chave` (M2)
 * @typedef {import('../adapters/crm-options.repository.js').OpcaoLista} OpcaoLista
 * @typedef {Record<string, OpcaoLista[]>} Listas  opções por `kind` (M3), inclusive as inativas
 * @typedef {{ visibilidade: FieldVisibility[], definicoes: FieldDefinition[], sobreposicoes?: Record<string, Sobreposicao>, listas?: Listas }} BaseSchema
 * @typedef {BaseSchema & { listas: Listas, campos: ReturnType<typeof montarCampos> }} SchemaCampos
 */

/** Toda escrita de configuração invalida — o TTL só cobre invalidação perdida. */
const TTL_CACHE_SEGUNDOS = 60;
const ORDEM_PADRAO = 0;
const CONTEXTO_FILTRO = CONTEXTOS_VISIBILIDADE.FILTRO;
const CONTRATO_POR_CHAVE = new Map(CAMPOS_SISTEMA.map((campo) => [campo.systemKey, campo]));

/**
 * O mesmo valor nos quatro contextos (padrão de campo sem configuração e
 * os campos do sistema sem linha de visibilidade).
 *
 * @param {boolean} visivel
 * @returns {VisibilidadePorContexto}
 */
export function emTodosOsContextos(visivel) {
  return Object.fromEntries(LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, visivel]));
}

/** @param {VisibilidadePorContexto} visibilidade */
const visivelEmAlgum = (visibilidade) => Object.values(visibilidade).some(Boolean);

/** @param {string} tenantId */
const chaveCache = (tenantId) => `crm:campos:${tenantId}`;

/**
 * @param {string} tenantId
 * @returns {Promise<SchemaCampos>}
 */
export async function obterSchemaCampos(tenantId) {
  const { visibilidade, definicoes, sobreposicoes, listas = {} } = await lerComCache(
    chaveCache(tenantId),
    TTL_CACHE_SEGUNDOS,
    () => carregarSchema(tenantId),
  );
  return { visibilidade, definicoes, listas, campos: montarCampos(visibilidade, definicoes, sobreposicoes, listas) };
}

/**
 * Chamado depois de toda escrita de configuração de campo ou de lista (e
 * do reconcile).
 *
 * @param {string} tenantId
 */
export function invalidarSchemaCampos(tenantId) {
  return cacheDel(chaveCache(tenantId));
}

/**
 * @param {string} tenantId
 * @returns {Promise<BaseSchema>}
 */
async function carregarSchema(tenantId) {
  const [linhas, opcoes] = await Promise.all([garantirCamposSistema(tenantId), garantirListas(tenantId)]);
  return { ...montarBaseDoModeloNovo(linhas), listas: agruparPorLista(opcoes) };
}

/**
 * Opções de lista do tenant, semeando antes as listas que faltarem (mesmo
 * racional de `garantirCamposSistema`).
 *
 * @param {string} tenantId
 * @returns {Promise<OpcaoLista[]>}
 */
export async function garantirListas(tenantId) {
  const opcoes = await buscarOpcoesDoTenant(tenantId);
  const kinds = new Set(opcoes.map((opcao) => opcao.kind));
  if (LISTAS_SEMEADAS.every((kind) => kinds.has(kind))) return opcoes;

  await reconciliarListas(tenantId);
  return buscarOpcoesDoTenant(tenantId);
}

/**
 * @param {OpcaoLista[]} opcoes  já na ordem configurada
 * @returns {Listas}
 */
export function agruparPorLista(opcoes) {
  /** @type {Listas} */
  const listas = {};
  for (const opcao of opcoes) (listas[opcao.kind] ??= []).push(opcao);
  return listas;
}

/**
 * Campo do sistema ligado a uma lista (status, origem, motivo de perda,
 * tags) ganha as opções do tenant: `opcoes` = keys ATIVAS (o que pode ser
 * gravado; tag é livre — valor novo vira opção ao gravar) e `opcoesLista`
 * = todas, com label/cor/categoria e `ativo`, pra tela mostrar o selo de
 * inativa no lead antigo.
 *
 * @template {{ lista?: string | null }} C
 * @param {C} campo
 * @param {Listas} listas
 */
function comOpcoesDaLista(campo, listas) {
  if (!campo.lista) return campo;
  const opcoes = listas[campo.lista] ?? [];
  return {
    ...campo,
    opcoes: campo.lista === TIPOS_LISTA.TAG ? null : opcoes.filter((opcao) => opcao.ativo).map((opcao) => opcao.key),
    opcoesLista: opcoes.map(({ key, label, color, category, ativo }) => ({ key, label, color, category, ativo })),
  };
}

/**
 * Linhas de `crm_field` do tenant, semeando antes os campos do sistema se
 * faltar algum (tenant criado antes do reconcile rodar) — idempotente,
 * então duas requisições simultâneas aqui não duplicam nada.
 *
 * @param {string} tenantId
 * @returns {Promise<import('../adapters/crm-fields.repository.js').CrmFieldRow[]>}
 */
export async function garantirCamposSistema(tenantId) {
  const linhas = await buscarCamposDoTenant(tenantId);
  if (linhas.filter((linha) => linha.system_key !== null).length >= CAMPOS_SISTEMA.length) return linhas;

  await reconciliarCampos(tenantId);
  return buscarCamposDoTenant(tenantId);
}

/**
 * Visibilidade de uma linha de `crm_field`, completando contexto sem linha
 * com o padrão (contrato do sistema; personalizado nasce visível).
 *
 * @param {import('../adapters/crm-fields.repository.js').CrmFieldRow} linha
 * @returns {VisibilidadePorContexto}
 */
export function visibilidadeDaLinha(linha) {
  const padrao = linha.system_key === null ? true : (CONTRATO_POR_CHAVE.get(linha.system_key)?.visivelPadrao ?? false);
  return Object.fromEntries(
    LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, linha.visibilidade?.[contexto] ?? padrao]),
  );
}

/**
 * Traduz as linhas de `crm_field` pro formato que os consumidores usam
 * (lista das 15 colunas de Camada 2 + definições personalizadas), mais as
 * sobreposições por campo (label renomeado, obrigatoriedade da Camada 1 e
 * visibilidade por contexto).
 *
 * @param {import('../adapters/crm-fields.repository.js').CrmFieldRow[]} linhas
 * @returns {BaseSchema}
 */
export function montarBaseDoModeloNovo(linhas) {
  const sistemaPorChave = new Map(
    linhas.filter((linha) => linha.system_key !== null).map((linha) => [linha.system_key, linha]),
  );

  const visibilidade = CAMADA_2_COLUNAS.map((coluna) => {
    const linha = sistemaPorChave.get(CAMADA_2_COLUNA_PARA_CAMPO[coluna]);
    return {
      coluna,
      // `visivel` = "aparece em algum contexto" (o dado continua vindo na
      // resposta; cada tela filtra pelo seu contexto).
      visivel: linha ? visivelEmAlgum(visibilidadeDaLinha(linha)) : false,
      ordem: linha?.position ?? ORDEM_PADRAO,
      obrigatorio: linha?.is_required ?? false,
    };
  });

  /** @type {Record<string, Sobreposicao>} */
  const sobreposicoes = {};
  for (const linha of linhas) {
    if (!linha.is_active) continue;
    const contrato = linha.system_key === null ? undefined : CONTRATO_POR_CHAVE.get(linha.system_key);
    if (linha.system_key !== null && !contrato) continue; // system_key fora do contrato atual
    sobreposicoes[linha.system_key ?? linha.chave] = {
      id: linha.id,
      label: contrato && !contrato.canRename ? contrato.label : linha.label,
      obrigatorio: contrato && !contrato.canMakeOptional ? contrato.obrigatorioPadrao : linha.is_required,
      ordem: linha.position,
      visibilidade: visibilidadeDaLinha(linha),
    };
  }

  const definicoes = linhas
    .filter((linha) => linha.system_key === null && linha.is_active)
    .map((linha) => ({
      id: linha.id,
      chave: linha.chave,
      label: linha.label,
      tipo: linha.type,
      opcoes: linha.options,
      obrigatorio: linha.is_required,
      ordem: linha.position,
      created_at: linha.created_at,
    }));

  return { visibilidade, definicoes, sobreposicoes };
}

/**
 * Lista única de campos ativos no shape `{ chave, label, tipo, camada,
 * obrigatorio, ordem, visibilidade, opcoes?, coluna? }` — Camada 1 +
 * Camada 2 visível + personalizados. Campo oculto em TODOS os contextos
 * fica de fora (é o "desligado" de antes); oculto só em alguns continua,
 * e cada tela filtra pelo seu com `camposDoContexto`.
 *
 * Campo sem sobreposição usa o contrato: label padrão e os quatro
 * contextos visíveis.
 *
 * @param {FieldVisibility[]} visibilidade
 * @param {FieldDefinition[]} definicoes
 * @param {Record<string, Sobreposicao>} [sobreposicoes]
 * @param {Listas} [listas]
 */
export function montarCampos(visibilidade, definicoes, sobreposicoes = {}, listas = {}) {
  // `coluna` (Camadas 1/2): nome da propriedade no lead lido (snake_case),
  // enquanto `chave` (camelCase) é o que vai no payload e no filtro. A
  // Camada 3 não tem `coluna` — o valor fica em `custom_fields`.
  const camposCamada1 = CAMPOS_CAMADA_1.map((campo) => {
    const sobre = sobreposicoes[campo.chave];
    return {
      ...comOpcoesDaLista(campo, listas),
      // `id` em crm_field (referência do layout, M4); sem linha, `null`.
      id: sobre?.id ?? null,
      label: sobre?.label ?? campo.label,
      obrigatorio: sobre?.obrigatorio ?? campo.obrigatorio,
      // ordem configurada (área Configurações); sem linha, a do contrato
      ordem: sobre?.ordem ?? campo.ordem,
      coluna: CAMADA_1_CAMPOS[campo.chave],
      camada: CAMADA.CAMADA_1,
      visibilidade: sobre?.visibilidade ?? emTodosOsContextos(true),
    };
  });

  const camposCamada2 = visibilidade
    .filter((item) => item.visivel)
    .map((item) => {
      const chave = CAMADA_2_COLUNA_PARA_CAMPO[item.coluna];
      const sobre = sobreposicoes[chave];
      return {
        chave,
        id: sobre?.id ?? null,
        coluna: item.coluna,
        ...comOpcoesDaLista(CAMADA_2_METADADOS[item.coluna], listas),
        label: sobre?.label ?? CAMADA_2_METADADOS[item.coluna].label,
        camada: CAMADA.CAMADA_2,
        obrigatorio: item.obrigatorio,
        ordem: item.ordem,
        visibilidade: sobre?.visibilidade ?? emTodosOsContextos(true),
      };
    });

  const camposCamada3 = definicoes.map((definicao) => ({
    ...definicao,
    camada: CAMADA.CAMADA_3,
    visibilidade: sobreposicoes[definicao.chave]?.visibilidade ?? emTodosOsContextos(true),
  }));

  return [...camposCamada1, ...camposCamada2, ...camposCamada3]
    .filter((campo) => visivelEmAlgum(campo.visibilidade))
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * Só os campos visíveis num contexto (`create_form`, `detail`, `table`,
 * `filter`) — o que cada tela usa. O filtro do back aplica o `filter`.
 *
 * @template {{ visibilidade: VisibilidadePorContexto }} C
 * @param {C[]} campos
 * @param {string} contexto
 * @returns {C[]}
 */
export function camposDoContexto(campos, contexto) {
  return campos.filter((campo) => campo.visibilidade[contexto]);
}

/**
 * Obrigatoriedade que vale na criação (formulário e import): campo
 * obrigatório fora do formulário de criação não pode travar o cadastro — a
 * Configuração já impede essa combinação, isto é a defesa pro dado que
 * chegou por outro caminho. Campo sem `visibilidade` (colunas extras da
 * planilha) conta como visível.
 *
 * @param {{ obrigatorio: boolean, visibilidade?: VisibilidadePorContexto }} campo
 */
export function exigidoNaCriacao(campo) {
  return campo.obrigatorio && (campo.visibilidade?.[CONTEXTOS_VISIBILIDADE.CRIACAO] ?? true);
}

/**
 * Campos pro tradutor de filtro: só os visíveis no contexto `filter` (M2 —
 * campo tirado dos filtros é rejeitado pelo back, não só escondido na
 * tela), com o personalizado lido de `custom_fields[id]`. Só pro SQL —
 * não vai pra resposta HTTP.
 *
 * @param {Pick<SchemaCampos, 'campos'>} schema
 */
export function camposParaFiltro(schema) {
  return camposDoContexto(schema.campos, CONTEXTO_FILTRO).map((campo) =>
    campo.camada === CAMADA.CAMADA_3 ? { ...campo, chaveArmazenamento: campo.id } : campo,
  );
}

/**
 * `customFields` da API (por `chave`) → o que vai pro banco (por `id`).
 * `null` (limpar) também é traduzido. Chave sem definição ativa (ex:
 * campo excluído entre validar e processar um import) é descartada — a
 * validação do formulário já rejeita chave desconhecida antes daqui.
 *
 * @param {FieldDefinition[]} definicoes
 * @param {Record<string, unknown> | undefined} customFields
 * @returns {Record<string, unknown> | undefined}
 */
export function customFieldsParaArmazenamento(definicoes, customFields) {
  if (customFields === undefined) return undefined;

  const idPorChave = new Map(definicoes.map((definicao) => [definicao.chave, definicao.id]));
  /** @type {Record<string, unknown>} */
  const armazenado = {};
  for (const [chave, valor] of Object.entries(customFields)) {
    const id = idPorChave.get(chave);
    if (id) armazenado[id] = valor;
  }
  return armazenado;
}

/**
 * `custom_fields` do banco (por `id`) → o que a API devolve (por `chave`).
 * Só entram campos personalizados ativos; valor de campo excluído fica no
 * banco (`custom_fields[id]`) sem aparecer na resposta.
 *
 * @param {FieldDefinition[]} definicoes
 * @param {Record<string, unknown> | null | undefined} armazenado
 * @returns {Record<string, unknown>}
 */
export function customFieldsParaApi(definicoes, armazenado) {
  const valores = armazenado ?? {};
  /** @type {Record<string, unknown>} */
  const resposta = {};
  for (const definicao of definicoes) {
    if (Object.hasOwn(valores, definicao.id)) resposta[definicao.chave] = valores[definicao.id];
  }
  return resposta;
}
