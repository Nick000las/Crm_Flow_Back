import { cacheDel, lerComCache } from '#core/cache/cache.js';
import { erroDeValidacao } from '#core/errors/app-error.js';
import {
  buscarLayoutPadrao,
  buscarOverride,
  excluirOverride,
  salvarLayoutPadrao,
  salvarOverride,
} from '../adapters/crm-layout.repository.js';
import {
  CAMADA,
  CONTEXTOS_VISIBILIDADE,
  IDENTIFICADORES_DO_SISTEMA,
  LAYOUT_INICIAL,
  LIMITES_LAYOUT,
  LISTAS_MESCLADAS,
  NOME_SECAO_OUTROS,
  NOME_SECAO_UNICA,
  PROPRIEDADES_LAYOUT,
  REFERENCIAS_FIXAS,
  TIPOS_CAMPO,
} from '../constants.js';
import { listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import { camposDoContexto, obterSchemaCampos } from './field-schema.service.js';
import { obterSchemaDoPapel } from './permissoes.service.js';

/**
 * SERVICE: layout do lead (docs/crm/plano-configuracoes.md, M4). Dois
 * níveis: o padrão do tenant (DONO/MASTER) e o override pessoal (parcial,
 * qualquer papel, com "Voltar ao padrão").
 *
 * O layout guarda referências (`crm_field.id` ou `lead.valor`...); a
 * leitura resolve contra o schema atual de campos e a visibilidade por
 * contexto do M2 — o layout organiza, a visibilidade esconde:
 * - identificador, subtítulo, destaques e seções usam o contexto `detail`;
 *   colunas, o `table`. Referência a campo oculto ou inativo some.
 * - Campo visível na ficha que não está em nenhuma seção vai pra uma seção
 *   automática no fim — campo novo nunca fica escondido sem querer.
 *
 * @typedef {{
 *   identificador: string, subtitulo: string[], destaques: string[],
 *   secoes: { nome: string, campos: string[] }[], colunas: string[],
 * }} LayoutRefs
 * @typedef {{
 *   ref: string, chave: string, label: string, tipo: string,
 *   camada?: number, coluna?: string, opcoesLista?: unknown[],
 * }} ItemLayout
 * @typedef {{
 *   identificador: ItemLayout, subtitulo: ItemLayout[], destaques: ItemLayout[],
 *   secoes: { nome: string, automatica: boolean, campos: ItemLayout[] }[], colunas: ItemLayout[],
 * }} LayoutResolvido
 * @typedef {import('./configuracoes-campos.service.js').CampoConfigurado} CampoConfigurado
 */

const TTL_CACHE_SEGUNDOS = 60;
const CONTEXTO_FICHA = CONTEXTOS_VISIBILIDADE.FICHA;
const CONTEXTO_TABELA = CONTEXTOS_VISIBILIDADE.TABELA;
const LIMITE_DA_LISTA = Object.freeze({ subtitulo: LIMITES_LAYOUT.SUBTITULO, destaques: LIMITES_LAYOUT.DESTAQUES });

/** @param {string} tenantId */
const chaveCache = (tenantId) => `crm:layout:${tenantId}`;

// ---------------------------------------------------------------------------
// Leitura e escrita
// ---------------------------------------------------------------------------

/**
 * Padrão do tenant (o salvo, ou o inicial do código), o override do
 * usuário e o layout efetivo já resolvido — o que drawer e tabela usam.
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ papel?: string }} [acesso]  M13: campo oculto pro papel sai do `efetivo`
 */
export async function obterLayout(tenantId, usuarioId, acesso = {}) {
  const [{ campos }, camposConfig, padraoSalvo, override] = await Promise.all([
    obterSchemaDoPapel(tenantId, acesso.papel),
    listarConfiguracaoCampos(tenantId),
    buscarLayoutPadrao(tenantId),
    buscarOverride(tenantId, usuarioId),
  ]);
  const padrao = padraoSalvo ?? layoutInicial(camposConfig);

  return {
    padrao,
    padraoConfigurado: Boolean(padraoSalvo),
    meu: override?.layout ?? null,
    efetivo: resolverLayout(mesclarLayout(padrao, override), campos),
  };
}

/**
 * PUT do padrão do tenant — layout completo.
 *
 * @param {string} tenantId
 * @param {string} usuarioId  quem salvou (a resposta é o layout dele)
 * @param {LayoutRefs} layout
 */
export async function salvarPadrao(tenantId, usuarioId, layout) {
  validarLayout(layout, await catalogo(tenantId));
  await salvarLayoutPadrao(tenantId, layout);
  await cacheDel(chaveCache(tenantId));
  return obterLayout(tenantId, usuarioId);
}

/**
 * PUT do override do usuário — parcial: o que não vier segue o padrão.
 * Guarda as listas do padrão de agora (`padraoVisto`) pra mescla futura.
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {Partial<LayoutRefs>} parcial
 * @param {{ papel?: string }} [acesso]
 */
export async function salvarMeu(tenantId, usuarioId, parcial, acesso = {}) {
  const camposConfig = await listarConfiguracaoCampos(tenantId);
  validarLayout(parcial, catalogoDe(camposConfig), { parcial: true });

  const padrao = (await buscarLayoutPadrao(tenantId)) ?? layoutInicial(camposConfig);
  const padraoVisto = Object.fromEntries(
    LISTAS_MESCLADAS.filter((propriedade) => parcial[propriedade] !== undefined).map((propriedade) => [
      propriedade,
      padrao[propriedade],
    ]),
  );
  await salvarOverride(tenantId, usuarioId, parcial, padraoVisto);
  return obterLayout(tenantId, usuarioId, acesso);
}

/**
 * "Voltar ao padrão".
 *
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ papel?: string }} [acesso]
 */
export async function removerMeu(tenantId, usuarioId, acesso = {}) {
  await excluirOverride(tenantId, usuarioId);
  return obterLayout(tenantId, usuarioId, acesso);
}

/**
 * Campo identificador do padrão do tenant, pra busca (M4.3): `null` quando
 * é Nome ou E-mail (a busca já cobre) ou quando o campo não é mais válido.
 * Em cache — a busca roda em toda listagem.
 *
 * @param {string} tenantId
 * @returns {Promise<{ chave: string, tipo: string, camada: number, coluna?: string, id: string | null } | null>}
 */
export async function identificadorDaBusca(tenantId) {
  const ref = await lerComCache(chaveCache(tenantId), TTL_CACHE_SEGUNDOS, async () => {
    const salvo = await buscarLayoutPadrao(tenantId);
    return salvo?.identificador ?? null;
  });
  if (!ref) return null;

  const { campos } = await obterSchemaCampos(tenantId);
  const campo = campos.find((item) => item.id === ref);
  if (!campo || campo.chave === 'nome' || campo.chave === 'email') return null;
  return { chave: campo.chave, tipo: campo.tipo, camada: campo.camada, coluna: campo.coluna, id: campo.id };
}

// ---------------------------------------------------------------------------
// Funções puras (testadas à parte)
// ---------------------------------------------------------------------------

/**
 * O layout inicial do código, com os `systemKey` trocados pelo `id` do
 * campo no tenant. Campo que o tenant não tem é ignorado.
 *
 * @param {CampoConfigurado[]} camposConfig
 * @returns {LayoutRefs}
 */
export function layoutInicial(camposConfig) {
  const idPorChave = new Map(
    camposConfig.filter((campo) => campo.systemKey).map((campo) => [campo.systemKey, campo.id]),
  );
  /** @param {string} item */
  const paraRef = (item) => (REFERENCIAS_FIXAS[item] ? item : idPorChave.get(item));
  const lista = (itens) => itens.map(paraRef).filter(Boolean);

  return {
    identificador: /** @type {string} */ (paraRef(LAYOUT_INICIAL.identificador)),
    subtitulo: lista(LAYOUT_INICIAL.subtitulo),
    destaques: lista(LAYOUT_INICIAL.destaques),
    secoes: [],
    colunas: lista(LAYOUT_INICIAL.colunas),
  };
}

/**
 * Padrão + override. Propriedade do override substitui a do padrão; nas
 * listas mescladas, o que o padrão ganhou DEPOIS do override (fora de
 * `padraoVisto`) entra no fim da lista do usuário, até o limite.
 *
 * @param {LayoutRefs} padrao
 * @param {{ layout: Partial<LayoutRefs>, padraoVisto: Record<string, string[]> } | undefined} override
 * @returns {LayoutRefs}
 */
export function mesclarLayout(padrao, override) {
  if (!override) return padrao;
  const { layout, padraoVisto = {} } = override;
  const mesclado = { ...padrao, ...layout };

  for (const propriedade of LISTAS_MESCLADAS) {
    const doUsuario = layout[propriedade];
    if (!doUsuario) continue;
    const visto = new Set(padraoVisto[propriedade] ?? []);
    const novos = padrao[propriedade].filter((ref) => !visto.has(ref) && !doUsuario.includes(ref));
    const limite = LIMITE_DA_LISTA[propriedade] ?? Number.POSITIVE_INFINITY;
    mesclado[propriedade] = [...doUsuario, ...novos].slice(0, Math.max(doUsuario.length, limite));
  }
  return mesclado;
}

/**
 * Referências → itens prontos pra tela, contra o schema atual.
 *
 * @param {LayoutRefs} layout
 * @param {ReturnType<typeof import('./field-schema.service.js').montarCampos>} campos
 * @returns {LayoutResolvido}
 */
export function resolverLayout(layout, campos) {
  const naFicha = new Map(camposDoContexto(campos, CONTEXTO_FICHA).map((campo) => [campo.id, campo]));
  const naTabela = new Map(camposDoContexto(campos, CONTEXTO_TABELA).map((campo) => [campo.id, campo]));

  /**
   * @param {Map<string | null, any>} visiveis
   * @param {string} ref
   * @returns {ItemLayout | undefined}
   */
  const item = (visiveis, ref) => {
    if (REFERENCIAS_FIXAS[ref]) return { ref, ...REFERENCIAS_FIXAS[ref] };
    const campo = visiveis.get(ref);
    if (!campo) return undefined;
    return {
      ref,
      chave: campo.chave,
      label: campo.label,
      tipo: campo.tipo,
      camada: campo.camada,
      ...(campo.coluna && { coluna: campo.coluna }),
      ...(campo.opcoesLista && { opcoesLista: campo.opcoesLista }),
    };
  };
  const itens = (visiveis, refs) => refs.map((ref) => item(visiveis, ref)).filter(Boolean);

  // Identificador oculto na ficha (ou inválido) cai pro Nome, que nunca é ocultado.
  const nome = campos.find((campo) => campo.chave === 'nome');
  const identificador = /** @type {ItemLayout} */ (item(naFicha, layout.identificador) ?? item(naFicha, nome?.id));

  const secoes = layout.secoes
    .map((secao) => ({ nome: secao.nome, automatica: false, campos: itens(naFicha, secao.campos) }))
    .filter((secao) => secao.campos.length > 0);
  const colocados = new Set(secoes.flatMap((secao) => secao.campos.map((campo) => campo.ref)));
  const soltos = [...naFicha.keys()].filter((id) => id && !colocados.has(id));
  if (soltos.length > 0) {
    secoes.push({
      nome: layout.secoes.length === 0 ? NOME_SECAO_UNICA : NOME_SECAO_OUTROS,
      automatica: true,
      campos: itens(naFicha, soltos),
    });
  }

  return {
    identificador,
    subtitulo: itens(naFicha, layout.subtitulo),
    destaques: itens(naFicha, layout.destaques),
    secoes,
    // A primeira coluna da tabela é sempre o identificador — não repete aqui.
    colunas: itens(naTabela, layout.colunas).filter((coluna) => coluna.ref !== identificador?.ref),
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 */
async function catalogo(tenantId) {
  return catalogoDe(await listarConfiguracaoCampos(tenantId));
}

/**
 * Referências aceitas: todo campo ativo (mesmo oculto agora — a
 * visibilidade pode mudar depois) e as fixas.
 *
 * @param {CampoConfigurado[]} camposConfig
 * @returns {Map<string, { systemKey: string | null, tipo: string, camada: number } | null>}
 */
function catalogoDe(camposConfig) {
  return new Map([
    ...camposConfig.map((campo) => [campo.id, { systemKey: campo.systemKey, tipo: campo.tipo, camada: campo.camada }]),
    ...Object.keys(REFERENCIAS_FIXAS).map((ref) => [ref, null]),
  ]);
}

/**
 * @param {Partial<LayoutRefs>} layout
 * @param {ReturnType<typeof catalogoDe>} refs
 * @param {{ parcial?: boolean }} [opcoes]
 */
export function validarLayout(layout, refs, { parcial = false } = {}) {
  /** @param {string} campo @param {string} ref */
  const exigirRef = (campo, ref) => {
    if (!refs.has(ref)) throw erroDeValidacao(campo, `"${ref}" não é um campo ativo`);
  };
  /** @param {string} campo @param {string[]} lista */
  const semRepetir = (campo, lista) => {
    if (new Set(lista).size !== lista.length) throw erroDeValidacao(campo, 'Cada campo só pode aparecer uma vez');
  };

  if (layout.identificador !== undefined) {
    exigirRef('identificador', layout.identificador);
    const campo = refs.get(layout.identificador);
    const permitido = campo
      ? IDENTIFICADORES_DO_SISTEMA.includes(campo.systemKey) ||
        (campo.camada === CAMADA.CAMADA_3 && campo.tipo === TIPOS_CAMPO.TEXTO)
      : false;
    if (!permitido) {
      throw erroDeValidacao(
        'identificador',
        'O identificador precisa ser Nome, Empresa, CNPJ, CPF, E-mail ou um campo personalizado de texto',
      );
    }
  }

  for (const propriedade of ['subtitulo', 'destaques', 'colunas']) {
    const lista = layout[propriedade];
    if (lista === undefined) continue;
    lista.forEach((ref) => exigirRef(propriedade, ref));
    semRepetir(propriedade, lista);
  }
  if (layout.colunas !== undefined && layout.colunas.length === 0) {
    throw erroDeValidacao('colunas', 'Escolha ao menos uma coluna');
  }

  if (layout.secoes !== undefined) {
    const nomes = layout.secoes.map((secao) => secao.nome.trim().toLowerCase());
    if (new Set(nomes).size !== nomes.length) throw erroDeValidacao('secoes', 'Duas seções com o mesmo nome');
    const todos = layout.secoes.flatMap((secao) => secao.campos);
    todos.forEach((ref) => exigirRef('secoes', ref));
    semRepetir('secoes', todos);
  }

  if (!parcial) {
    const faltando = PROPRIEDADES_LAYOUT.filter(
      (propriedade) => layout[propriedade] === undefined,
    );
    if (faltando.length > 0) throw erroDeValidacao(faltando[0], 'O padrão precisa do layout completo');
  }
}
