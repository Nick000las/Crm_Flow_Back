import { erroDeConflito, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import {
  atualizarRegra,
  buscarRegrasDoTenant,
  excluirRegra,
  inserirRegra,
} from '../adapters/crm-field-rules.repository.js';
import { CATEGORIAS_STATUS, LIMITES_REGRAS, TIPOS_LISTA, TIPOS_REGRA } from '../constants.js';
import { invalidarSchemaCampos, obterSchemaCampos } from './field-schema.service.js';
import { montarCondicoes } from './lead-filter.service.js';

/**
 * SERVICE: Configurações → regras de campo (M8). Leitura vem do schema
 * (`obterSchemaCampos().regras`, já resolvida contra os campos ativos);
 * escrita valida contra o tenant e invalida o cache do schema.
 *
 * - `required_from_status`: `condicao = { status?, categorias? }` (ao menos
 *   um), efeito sempre obrigatório.
 * - `conditional`: `condicao = { campoId, operador, valor? }` com os
 *   operadores do filtro, `efeito = { obrigatorio?, visivel? }` (ao menos um).
 * - Regra do sistema (ex.: Perdido exige Motivo): só liga/desliga.
 *
 * @typedef {import('./regras-campos.service.js').Regra} Regra
 * @typedef {{ kind: string, campoId: string, condicao: Record<string, any>, efeito?: Record<string, boolean>, ativo?: boolean }} NovaRegra
 */

const CATEGORIAS = new Set(Object.values(CATEGORIAS_STATUS));

/** @param {string} tenantId */
export async function listarRegras(tenantId) {
  return (await obterSchemaCampos(tenantId)).regras;
}

/**
 * @param {string} tenantId
 * @param {NovaRegra} input
 */
export async function criarRegra(tenantId, input) {
  const [schema, existentes] = await Promise.all([obterSchemaCampos(tenantId), buscarRegrasDoTenant(tenantId)]);
  if (existentes.length >= LIMITES_REGRAS.POR_TENANT) {
    throw erroDeValidacao('kind', `Use no máximo ${LIMITES_REGRAS.POR_TENANT} regras`);
  }
  const regra = normalizarRegra(input, schema);
  const criada = await inserirRegra(tenantId, { ...regra, ativo: input.ativo ?? true });
  return regraResolvida(tenantId, criada.id);
}

/**
 * Parcial. `kind` não muda (é outra regra); na do sistema, só `ativo`.
 *
 * @param {string} tenantId
 * @param {string} regraId
 * @param {Partial<NovaRegra>} input
 */
export async function editarRegra(tenantId, regraId, input) {
  const [schema, linhas] = await Promise.all([obterSchemaCampos(tenantId), buscarRegrasDoTenant(tenantId)]);
  const atual = linhas.find((linha) => linha.id === regraId);
  if (!atual) throw regraNaoEncontrada();

  const mudaConteudo = ['campoId', 'condicao', 'efeito'].some((chave) => input[chave] !== undefined);
  if (atual.system_key && mudaConteudo) {
    throw erroDeConflito('id', 'A regra do sistema só pode ser ligada ou desligada');
  }
  if (input.kind !== undefined && input.kind !== atual.kind) {
    throw erroDeValidacao('kind', 'O tipo da regra não muda; crie outra regra');
  }

  const conteudo = atual.system_key
    ? { campoId: atual.field_id, condicao: atual.condition, efeito: atual.effect }
    : normalizarRegra(
        {
          kind: atual.kind,
          campoId: input.campoId ?? atual.field_id,
          condicao: input.condicao ?? atual.condition,
          efeito: input.efeito ?? atual.effect,
        },
        schema,
      );
  await atualizarRegra(tenantId, regraId, { ...conteudo, ativo: input.ativo ?? atual.is_active });
  return regraResolvida(tenantId, regraId);
}

/**
 * @param {string} tenantId
 * @param {string} regraId
 */
export async function removerRegra(tenantId, regraId) {
  const linhas = await buscarRegrasDoTenant(tenantId);
  const atual = linhas.find((linha) => linha.id === regraId);
  if (!atual) throw regraNaoEncontrada();
  if (atual.system_key) throw erroDeConflito('id', 'A regra do sistema não pode ser excluída; desligue-a');

  await excluirRegra(tenantId, regraId);
  await invalidarSchemaCampos(tenantId);
  return { removido: true };
}

/**
 * @param {string} tenantId
 * @param {string} regraId
 * @returns {Promise<Regra>}
 */
async function regraResolvida(tenantId, regraId) {
  await invalidarSchemaCampos(tenantId);
  const { regras } = await obterSchemaCampos(tenantId);
  return /** @type {Regra} */ (regras.find((regra) => regra.id === regraId));
}

/**
 * Valida e devolve o que é gravado: `{ kind, campoId, condicao, efeito }`.
 *
 * @param {NovaRegra} input
 * @param {import('./field-schema.service.js').SchemaCampos} schema
 */
function normalizarRegra({ kind, campoId, condicao, efeito }, { campos, listas }) {
  const porId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));
  if (!porId.has(campoId)) throw erroDeValidacao('campoId', 'Escolha um campo ativo');

  if (kind === TIPOS_REGRA.POR_STATUS) {
    const status = [...new Set(condicao.status ?? [])];
    const categorias = [...new Set(condicao.categorias ?? [])];
    if (status.length + categorias.length === 0) {
      throw erroDeValidacao('condicao', 'Escolha ao menos um status ou uma categoria');
    }
    if (status.length > LIMITES_REGRAS.STATUS_POR_REGRA) {
      throw erroDeValidacao('condicao', `Use no máximo ${LIMITES_REGRAS.STATUS_POR_REGRA} status`);
    }
    const keys = new Set((listas[TIPOS_LISTA.STATUS] ?? []).map((opcao) => opcao.key));
    const desconhecido = status.find((key) => !keys.has(key));
    if (desconhecido) throw erroDeValidacao('condicao', `"${desconhecido}" não é uma opção de Status`);
    const categoriaInvalida = categorias.find((categoria) => !CATEGORIAS.has(categoria));
    if (categoriaInvalida) throw erroDeValidacao('condicao', `"${categoriaInvalida}" não é uma categoria de status`);
    return { kind, campoId, condicao: { status, categorias }, efeito: { obrigatorio: true } };
  }

  const campo = porId.get(condicao.campoId);
  if (!campo) throw erroDeValidacao('condicao', 'Escolha um campo ativo para a condição');
  if (condicao.campoId === campoId) throw erroDeValidacao('condicao', 'A condição precisa ser sobre outro campo');
  try {
    // Mesmas regras de operador × tipo e de formato de valor do filtro.
    montarCondicoes({ filtros: [{ chave: campo.chave, operador: condicao.operador, valor: condicao.valor }] }, [campo]);
  } catch (erro) {
    throw erroDeValidacao('condicao', erro instanceof Error ? erro.message : 'Condição inválida');
  }

  const obrigatorio = efeito?.obrigatorio === true;
  const visivel = efeito?.visivel === true;
  if (!obrigatorio && !visivel) {
    throw erroDeValidacao('efeito', 'A regra precisa tornar o campo obrigatório e/ou visível');
  }
  const valor = ['vazio', 'nao_vazio'].includes(condicao.operador) ? undefined : condicao.valor;
  return { kind, campoId, condicao: { campoId: condicao.campoId, operador: condicao.operador, valor }, efeito: { obrigatorio, visivel } };
}

function regraNaoEncontrada() {
  return erroNaoEncontrado('Regra não encontrada');
}
