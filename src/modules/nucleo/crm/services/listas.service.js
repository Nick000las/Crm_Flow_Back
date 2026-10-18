import { erroDeConflito, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { slugify } from '#shared/text/slugify.js';
import {
  atualizarOpcao as atualizarOpcaoRepository,
  contarUsos,
  excluirOpcao as excluirOpcaoRepository,
  inserirOpcoes,
  proximaPosicao,
  reordenarOpcoes,
} from '../adapters/crm-options.repository.js';
import {
  CATEGORIAS_OBRIGATORIAS,
  COLUNA_DA_LISTA,
  LISTA_DO_CAMPO,
  LISTA_TIPOS_LISTA,
  LISTAS_SEMEADAS,
  TIPOS_LISTA,
} from '../constants.js';
import { invalidarSchemaCampos, obterSchemaCampos } from './field-schema.service.js';

/**
 * SERVICE: listas configuráveis (docs/crm/plano-configuracoes.md, M3) —
 * Status, Origem, Motivo de perda, Tipo de atividade e Tag. Toda regra
 * mora aqui; a tela só reflete:
 *
 * - `key` é imutável (slug do label, com sufixo em colisão) e é o que o
 *   lead guarda — renomear muda só o `label`;
 * - opção em uso não é excluída, só desativada; inativa some dos
 *   seletores, mas o lead antigo continua mostrando (com selo);
 * - sempre sobra ao menos um status ativo de cada categoria obrigatória
 *   (ganho, perdido) e ao menos uma opção nas listas semeadas;
 * - lead só grava opção ativa (a não ser a que ele já tinha) e tag nova
 *   entra na lista sozinha.
 *
 * @typedef {import('../adapters/crm-options.repository.js').OpcaoLista} OpcaoLista
 * @typedef {import('./field-schema.service.js').Listas} Listas
 * @typedef {OpcaoLista & { usos: number }} OpcaoComUso
 */

/** Nome da lista nas mensagens de erro. */
const NOME_DA_LISTA = Object.freeze({
  [TIPOS_LISTA.STATUS]: 'Status',
  [TIPOS_LISTA.FONTE_LEAD]: 'Origem',
  [TIPOS_LISTA.MOTIVO_PERDA]: 'Motivo da perda',
  [TIPOS_LISTA.TIPO_ATIVIDADE]: 'Tipo de atividade',
  [TIPOS_LISTA.TAG]: 'Tags',
});

const KEY_PADRAO = 'opcao';
const PRIMEIRO_SUFIXO = 2;

// ---------------------------------------------------------------------------
// Configuração (área Configurações → Listas)
// ---------------------------------------------------------------------------

/**
 * Todas as listas, com as opções inativas e quantos leads usam cada uma
 * (a tela desabilita "excluir" quando `usos > 0`).
 *
 * @param {string} tenantId
 * @returns {Promise<Record<string, OpcaoComUso[]>>}
 */
export async function listarListas(tenantId) {
  const { listas } = await obterSchemaCampos(tenantId);
  const usos = await Promise.all(LISTA_TIPOS_LISTA.map((kind) => contarUsos(tenantId, kind)));

  return Object.fromEntries(
    LISTA_TIPOS_LISTA.map((kind, indice) => [
      kind,
      (listas[kind] ?? []).map((opcao) => ({ ...opcao, usos: usos[indice].get(opcao.key) ?? 0 })),
    ]),
  );
}

/**
 * @param {string} tenantId
 * @param {string} kind
 * @param {{ label: string, color?: string | null, category?: string }} dados
 * @returns {Promise<OpcaoLista>}
 */
export async function criarOpcao(tenantId, kind, { label, color = null, category }) {
  const opcoes = await opcoesDaLista(tenantId, kind);
  const nome = garantirLabelLivre(opcoes, label);
  validarCategoria(kind, category, { obrigatoria: true });

  const key = chaveUnica(slugify(nome) || KEY_PADRAO, new Set(opcoes.map((opcao) => opcao.key)));
  const [criada] = await inserirOpcoes(tenantId, kind, [
    { key, label: nome, color, category: category ?? null, position: await proximaPosicao(tenantId, kind) },
  ]);
  // Outra requisição criou a mesma key entre a leitura e o INSERT.
  if (!criada) throw erroDeConflito('label', 'Já existe uma opção com esse nome');

  await invalidarSchemaCampos(tenantId);
  return criada;
}

/**
 * PUT parcial: `label`, `color` (`null` limpa), `category` (só status) e
 * `ativo`. `key` nunca muda.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @param {string} opcaoId
 * @param {{ label?: string, color?: string | null, category?: string, ativo?: boolean }} mudancas
 * @returns {Promise<OpcaoLista>}
 */
export async function atualizarOpcao(tenantId, kind, opcaoId, mudancas) {
  const opcoes = await opcoesDaLista(tenantId, kind);
  const atual = opcoes.find((opcao) => opcao.id === opcaoId);
  if (!atual) throw opcaoNaoEncontrada();

  const label = mudancas.label === undefined ? undefined : garantirLabelLivre(opcoes, mudancas.label, opcaoId);
  validarCategoria(kind, mudancas.category, { obrigatoria: false });

  const depois = { ...atual, ...(mudancas.category && { category: mudancas.category }) };
  if (mudancas.ativo !== undefined) depois.ativo = mudancas.ativo;
  garantirCategoriasObrigatorias(
    kind,
    opcoes.map((opcao) => (opcao.id === opcaoId ? depois : opcao)),
  );

  const atualizada = await atualizarOpcaoRepository(tenantId, opcaoId, { ...mudancas, label });
  if (!atualizada) throw opcaoNaoEncontrada();
  await invalidarSchemaCampos(tenantId);
  return atualizada;
}

/**
 * Nova ordem de UMA lista — todas as opções dela (ativas e inativas),
 * cada uma uma vez.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @param {string[]} ids
 * @returns {Promise<OpcaoLista[]>}
 */
export async function reordenarLista(tenantId, kind, ids) {
  const opcoes = await opcoesDaLista(tenantId, kind);
  const esperados = new Set(opcoes.map((opcao) => opcao.id));
  const recebidos = new Set(ids);
  const completa =
    recebidos.size === ids.length && ids.length === esperados.size && ids.every((id) => esperados.has(id));
  if (!completa) {
    throw erroDeValidacao('ids', 'Envie todas as opções da lista, cada uma uma única vez, na ordem desejada');
  }

  await reordenarOpcoes(tenantId, kind, ids);
  await invalidarSchemaCampos(tenantId);
  return opcoesDaLista(tenantId, kind);
}

/**
 * Exclusão de verdade, só sem nenhum lead usando — com uso, desativar.
 *
 * @param {string} tenantId
 * @param {string} kind
 * @param {string} opcaoId
 * @returns {Promise<{ removido: true }>}
 */
export async function excluirOpcao(tenantId, kind, opcaoId) {
  const opcoes = await opcoesDaLista(tenantId, kind);
  const alvo = opcoes.find((opcao) => opcao.id === opcaoId);
  if (!alvo) throw opcaoNaoEncontrada();

  const usos = (await contarUsos(tenantId, kind)).get(alvo.key) ?? 0;
  if (usos > 0) {
    throw erroDeConflito(
      'opcao',
      `"${alvo.label}" está em ${usos} lead(s) — desative em vez de excluir`,
    );
  }
  if (LISTAS_SEMEADAS.includes(kind) && opcoes.length === 1) {
    throw erroDeConflito('opcao', `A lista ${NOME_DA_LISTA[kind]} precisa de ao menos uma opção`);
  }
  garantirCategoriasObrigatorias(
    kind,
    opcoes.filter((opcao) => opcao.id !== opcaoId),
  );

  if (!(await excluirOpcaoRepository(tenantId, opcaoId))) throw opcaoNaoEncontrada();
  await invalidarSchemaCampos(tenantId);
  return { removido: true };
}

/**
 * Categoria (aberto/ganho/perdido) do status gravado num lead — é por ela,
 * nunca pelo nome, que regra e relatório decidem (renomear "Perdido" não
 * muda nada).
 *
 * @param {Listas} listas
 * @param {string | null | undefined} statusKey
 * @returns {string | null}
 */
export function categoriaDoStatus(listas, statusKey) {
  if (!statusKey) return null;
  return listas[TIPOS_LISTA.STATUS]?.find((opcao) => opcao.key === statusKey)?.category ?? null;
}

// ---------------------------------------------------------------------------
// Lado do lead (formulário, edição, import)
// ---------------------------------------------------------------------------

/**
 * Confere os campos de lista do payload contra as opções do tenant e
 * traduz as tags pra keys. Opção inativa só passa se o lead já a tinha
 * (editar um lead antigo não pode travar por causa dela) — o lead atual só
 * é lido nesse caso, via `carregarAtual`.
 *
 * Não grava nada: as tags que ainda não existem voltam em `tagsNovas`, pra
 * quem chama criar logo antes de gravar o lead (`gravarTagsNovas`).
 *
 * @template {Record<string, unknown>} T
 * @param {Listas} listas
 * @param {T} input
 * @param {() => Promise<Record<string, unknown> | undefined>} [carregarAtual]
 * @returns {Promise<{ input: T, tagsNovas: { key: string, label: string }[] }>}
 */
export async function resolverOpcoesDoLead(listas, input, carregarAtual = async () => undefined) {
  /** @type {Record<string, unknown> | undefined | null} */
  let atual = null;
  const leadAtual = async () => {
    if (atual === null) atual = (await carregarAtual()) ?? undefined;
    return atual;
  };

  for (const [chave, kind] of Object.entries(LISTA_DO_CAMPO)) {
    if (kind === TIPOS_LISTA.TAG) continue;
    const valor = input[chave];
    if (valor === undefined || valor === null) continue;

    const opcao = listas[kind]?.find((item) => item.key === valor);
    if (!opcao) {
      throw erroDeValidacao(chave, `"${valor}" não é uma opção de ${NOME_DA_LISTA[kind]}`);
    }
    if (!opcao.ativo && (await leadAtual())?.[COLUNA_DA_LISTA[kind]] !== valor) {
      throw erroDeValidacao(chave, `"${opcao.label}" está desativada em ${NOME_DA_LISTA[kind]}`);
    }
  }

  if (!Array.isArray(input.tags)) return { input, tagsNovas: [] };
  const { keys, tagsNovas } = await resolverTags(listas[TIPOS_LISTA.TAG] ?? [], input.tags, leadAtual);
  return { input: { ...input, tags: keys }, tagsNovas };
}

/**
 * Tag existente que casa com o texto: pela key, pelo label (sem diferenciar
 * maiúscula) ou pelo slug. Também usado pra "remover tag" da edição em
 * massa (M10), que não cria nada.
 *
 * @param {OpcaoLista[]} tags
 * @returns {(texto: string) => OpcaoLista | undefined}
 */
export function buscadorDeTags(tags) {
  const porKey = new Map(tags.map((tag) => [tag.key, tag]));
  const porLabel = new Map(tags.map((tag) => [tag.label.trim().toLowerCase(), tag]));
  return (bruto) => {
    const texto = bruto.trim();
    const slug = slugify(texto);
    return porKey.get(texto) ?? porLabel.get(texto.toLowerCase()) ?? (slug ? porKey.get(slug) : undefined);
  };
}

/**
 * Tag digitada → key: casa com a key, com o label (sem diferenciar
 * maiúscula) ou com o slug de uma tag existente; senão vira tag nova.
 *
 * @param {OpcaoLista[]} tags
 * @param {string[]} textos
 * @param {() => Promise<Record<string, unknown> | undefined>} leadAtual
 */
async function resolverTags(tags, textos, leadAtual) {
  const encontrar = buscadorDeTags(tags);
  const usadas = new Set(tags.map((tag) => tag.key));
  /** @type {string[]} */
  const keys = [];
  /** @type {{ key: string, label: string }[]} */
  const tagsNovas = [];

  for (const bruto of textos) {
    const texto = bruto.trim();
    if (!texto) continue;
    const slug = slugify(texto);
    const existente = encontrar(texto);

    if (existente) {
      const tagsDoLead = /** @type {string[] | undefined} */ ((await leadAtual())?.tags);
      if (!existente.ativo && !tagsDoLead?.includes(existente.key)) {
        throw erroDeValidacao('tags', `A tag "${existente.label}" está desativada`);
      }
      if (!keys.includes(existente.key)) keys.push(existente.key);
      continue;
    }

    const repetida = tagsNovas.find((nova) => nova.label.toLowerCase() === texto.toLowerCase());
    if (repetida) {
      if (!keys.includes(repetida.key)) keys.push(repetida.key);
      continue;
    }
    const key = chaveUnica(slug || KEY_PADRAO, usadas);
    usadas.add(key);
    tagsNovas.push({ key, label: texto });
    keys.push(key);
  }

  return { keys, tagsNovas };
}

/**
 * Cria as tags novas de um lead (logo antes de gravar o lead). Idempotente
 * por key — duas requisições com a mesma tag nova não duplicam.
 *
 * @param {string} tenantId
 * @param {{ key: string, label: string }[]} tagsNovas
 */
export async function gravarTagsNovas(tenantId, tagsNovas) {
  if (tagsNovas.length === 0) return;
  const inicio = await proximaPosicao(tenantId, TIPOS_LISTA.TAG);
  await inserirOpcoes(
    tenantId,
    TIPOS_LISTA.TAG,
    tagsNovas.map((tag, indice) => ({ ...tag, position: inicio + indice })),
  );
  await invalidarSchemaCampos(tenantId);
}

// ---------------------------------------------------------------------------
// Regras internas
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 * @param {string} kind
 */
async function opcoesDaLista(tenantId, kind) {
  return (await obterSchemaCampos(tenantId)).listas[kind] ?? [];
}

/**
 * Nome único na lista (sem diferenciar maiúscula).
 *
 * @param {OpcaoLista[]} opcoes
 * @param {string} label
 * @param {string} [ignorarId]
 */
function garantirLabelLivre(opcoes, label, ignorarId) {
  const nome = label.trim();
  if (!nome) throw erroDeValidacao('label', 'Informe o nome da opção');
  const repetida = opcoes.some(
    (opcao) => opcao.id !== ignorarId && opcao.label.trim().toLowerCase() === nome.toLowerCase(),
  );
  if (repetida) throw erroDeConflito('label', 'Já existe uma opção com esse nome');
  return nome;
}

/**
 * Categoria só existe em status — e todo status novo precisa de uma.
 *
 * @param {string} kind
 * @param {string | undefined} category
 * @param {{ obrigatoria: boolean }} opcoes
 */
function validarCategoria(kind, category, { obrigatoria }) {
  if (kind !== TIPOS_LISTA.STATUS) {
    if (category !== undefined) throw erroDeValidacao('category', 'Só a lista Status tem categoria');
    return;
  }
  if (obrigatoria && category === undefined) {
    throw erroDeValidacao('category', 'Informe a categoria do status (aberto, ganho ou perdido)');
  }
}

/**
 * O funil precisa fechar: ao menos um status ATIVO em cada categoria
 * obrigatória, depois da mudança.
 *
 * @param {string} kind
 * @param {OpcaoLista[]} opcoesDepois
 */
function garantirCategoriasObrigatorias(kind, opcoesDepois) {
  if (kind !== TIPOS_LISTA.STATUS) return;
  for (const categoria of CATEGORIAS_OBRIGATORIAS) {
    if (!opcoesDepois.some((opcao) => opcao.ativo && opcao.category === categoria)) {
      throw erroDeConflito('category', `É preciso manter ao menos um status ativo da categoria "${categoria}"`);
    }
  }
}

/**
 * `base`, ou `base_2`, `base_3`... — a primeira que não está em `usadas`.
 *
 * @param {string} base
 * @param {Set<string>} usadas
 */
export function chaveUnica(base, usadas) {
  if (!usadas.has(base)) return base;
  let sufixo = PRIMEIRO_SUFIXO;
  while (usadas.has(`${base}_${sufixo}`)) sufixo += 1;
  return `${base}_${sufixo}`;
}

function opcaoNaoEncontrada() {
  return erroNaoEncontrado('Opção não encontrada');
}
