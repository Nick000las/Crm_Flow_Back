import { erroDeValidacao, erroNaoEncontrado, erroDeConflito } from '#core/errors/app-error.js';
import {
  atualizarCampoConfigurado,
  buscarCamposDoTenant,
  reordenarCampos as reordenarCamposRepository,
} from '../adapters/crm-fields.repository.js';
import {
  CAMADA,
  CAMPOS_SISTEMA,
  CAPACIDADES_PERSONALIZADO,
  CONTEXTOS_VISIBILIDADE,
} from '../constants.js';
import { garantirCamposSistema, invalidarSchemaCampos, obterSchemaCampos, visibilidadeDaLinha } from './field-schema.service.js';

/**
 * SERVICE: área Configurações → Campos (docs/crm/plano-configuracoes.md,
 * M2), sobre `crm_field`. Toda regra de
 * capacidade (`canHide`/`canMakeOptional`/`canRename`) é validada aqui;
 * a tela só reflete.
 *
 * @typedef {{
 *   id: string, chave: string, systemKey: string | null, camada: 1 | 2 | 3,
 *   label: string, labelPadrao: string | null, tipo: string,
 *   opcoes: readonly string[] | null, lista: string | null, obrigatorio: boolean, ordem: number,
 *   visibilidade: Record<string, boolean>,
 *   capacidades: { canHide: boolean, canMakeOptional: boolean, canRename: boolean },
 * }} CampoConfigurado
 */

const CONTRATO_POR_CHAVE = new Map(CAMPOS_SISTEMA.map((campo) => [campo.systemKey, campo]));

/**
 * Todos os campos ativos do tenant — inclusive os ocultos em todo
 * contexto, que o formulário/tabela nunca veem —, na ordem configurada.
 *
 * @param {string} tenantId
 * @returns {Promise<CampoConfigurado[]>}
 */
export async function listarConfiguracaoCampos(tenantId) {
  const linhas = await garantirCamposSistema(tenantId);
  const { listas } = await obterSchemaCampos(tenantId);
  return linhas
    .filter((linha) => linha.is_active && (linha.system_key === null || CONTRATO_POR_CHAVE.has(linha.system_key)))
    .map((linha) => paraCampoConfigurado(linha, listas));
}

/**
 * @param {import('../adapters/crm-fields.repository.js').CrmFieldRow} linha
 * @param {import('./field-schema.service.js').Listas} listas
 * @returns {CampoConfigurado}
 */
function paraCampoConfigurado(linha, listas) {
  const contrato = linha.system_key === null ? undefined : CONTRATO_POR_CHAVE.get(linha.system_key);
  const capacidades = contrato
    ? { canHide: contrato.canHide, canMakeOptional: contrato.canMakeOptional, canRename: contrato.canRename }
    : { ...CAPACIDADES_PERSONALIZADO };

  return {
    id: linha.id,
    chave: linha.system_key ?? linha.chave,
    systemKey: linha.system_key,
    camada: contrato ? contrato.camada : CAMADA.CAMADA_3,
    label: contrato && !contrato.canRename ? contrato.label : linha.label,
    labelPadrao: contrato ? contrato.label : null,
    tipo: contrato ? contrato.tipo : linha.type,
    // Campo de lista (M3): as keys ativas; a gestão fica em Configurações → Listas.
    // Opções fixas do sistema (M15, base legal): as do contrato.
    opcoes: contrato?.lista ? opcoesAtivas(listas, contrato.lista) : (contrato ? (contrato.opcoes ?? null) : linha.options),
    lista: contrato?.lista ?? null,
    obrigatorio: contrato && !contrato.canMakeOptional ? contrato.obrigatorioPadrao : linha.is_required,
    ordem: linha.position,
    visibilidade: visibilidadeDaLinha(linha),
    capacidades,
  };
}

/**
 * @param {import('./field-schema.service.js').Listas} listas
 * @param {string} kind
 */
function opcoesAtivas(listas, kind) {
  return (listas[kind] ?? []).filter((opcao) => opcao.ativo).map((opcao) => opcao.key);
}

/**
 * PUT de um campo: `label` (`null` = volta ao padrão do sistema),
 * `obrigatorio` e `visibilidade` parcial por contexto. Desligar contexto
 * nunca apaga dado.
 *
 * @param {string} tenantId
 * @param {string} fieldId
 * @param {{ label?: string | null, obrigatorio?: boolean, visibilidade?: Record<string, boolean> }} mudancas
 * @returns {Promise<CampoConfigurado>}
 */
export async function atualizarConfiguracaoCampo(tenantId, fieldId, mudancas) {
  const campos = await listarConfiguracaoCampos(tenantId);
  const campo = campos.find((item) => item.id === fieldId);
  if (!campo) throw campoNaoEncontrado();

  const label = resolverLabel(campo, mudancas.label, campos);

  if (
    mudancas.obrigatorio !== undefined &&
    mudancas.obrigatorio !== campo.obrigatorio &&
    !campo.capacidades.canMakeOptional
  ) {
    throw erroDeValidacao('obrigatorio', `A obrigatoriedade de "${campo.label}" é fixa`);
  }

  const visibilidade = { ...campo.visibilidade, ...mudancas.visibilidade };
  if (!campo.capacidades.canHide && Object.values(visibilidade).some((visivel) => !visivel)) {
    throw erroDeValidacao('visibilidade', `"${campo.label}" não pode ser ocultado`);
  }

  const obrigatorio = mudancas.obrigatorio ?? campo.obrigatorio;
  if (obrigatorio && !visibilidade[CONTEXTOS_VISIBILIDADE.CRIACAO]) {
    throw erroDeValidacao(
      'visibilidade',
      `"${campo.label}" é obrigatório e precisa aparecer no formulário de criação`,
    );
  }

  await atualizarCampoConfigurado(tenantId, fieldId, {
    label,
    isRequired: mudancas.obrigatorio,
    visibilidade: mudancas.visibilidade,
  });
  await invalidarSchemaCampos(tenantId);

  const atualizado = (await listarConfiguracaoCampos(tenantId)).find((item) => item.id === fieldId);
  return /** @type {CampoConfigurado} */ (atualizado);
}

/**
 * @param {CampoConfigurado} campo
 * @param {string | null | undefined} label
 * @param {CampoConfigurado[]} campos
 * @returns {string | undefined} o label a gravar (`undefined` = não muda)
 */
function resolverLabel(campo, label, campos) {
  if (label === undefined) return undefined;

  if (!campo.capacidades.canRename) {
    throw erroDeValidacao('label', `"${campo.label}" não pode ser renomeado`);
  }
  if (label === null) {
    if (campo.labelPadrao === null) throw erroDeValidacao('label', 'Informe o nome do campo');
    return campo.labelPadrao;
  }

  return garantirLabelDisponivel(campos, label, campo.id);
}

/**
 * Nome de campo é único no tenant (sistema + personalizados, sem
 * diferenciar maiúscula) — vale pra criar, renomear e editar.
 *
 * @param {CampoConfigurado[]} campos  todos os campos ativos do tenant
 * @param {string} label
 * @param {string | null} [ignorarId]  o próprio campo, numa edição
 * @returns {string} o label aparado
 */
export function garantirLabelDisponivel(campos, label, ignorarId = null) {
  const novo = label.trim();
  if (!novo) throw erroDeValidacao('label', 'Informe o nome do campo');

  const repetido = campos.some(
    (outro) => outro.id !== ignorarId && outro.label.trim().toLowerCase() === novo.toLowerCase(),
  );
  if (repetido) {
    throw erroDeConflito('label', 'Já existe um campo com esse nome');
  }
  return novo;
}

/**
 * Ordem nova de TODOS os campos ativos (sistema + personalizados): a lista
 * precisa ter cada um exatamente uma vez — ordem parcial deixaria posições
 * repetidas.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<CampoConfigurado[]>}
 */
export async function reordenarCampos(tenantId, ids) {
  const campos = await listarConfiguracaoCampos(tenantId);
  const esperados = new Set(campos.map((campo) => campo.id));
  const recebidos = new Set(ids);

  const desconhecido = ids.find((id) => !esperados.has(id));
  const faltando = campos.find((campo) => !recebidos.has(campo.id));
  if (desconhecido || faltando || recebidos.size !== ids.length) {
    throw erroDeValidacao(
      'ids',
      'Envie todos os campos, cada um uma única vez, na ordem desejada',
    );
  }

  await reordenarCamposRepository(tenantId, ids);
  await invalidarSchemaCampos(tenantId);
  return listarConfiguracaoCampos(tenantId);
}

/**
 * "Voltar ao padrão": campos do sistema na ordem do contrato
 * (`ordemPadrao`, a mesma de um tenant novo) e personalizados depois, por
 * data de criação.
 *
 * @param {string} tenantId
 * @returns {Promise<CampoConfigurado[]>}
 */
export async function restaurarOrdemPadrao(tenantId) {
  const linhas = (await buscarCamposDoTenant(tenantId)).filter((linha) => linha.is_active);
  const sistema = linhas
    .filter((linha) => linha.system_key !== null && CONTRATO_POR_CHAVE.has(linha.system_key))
    .sort((a, b) => CONTRATO_POR_CHAVE.get(a.system_key).ordemPadrao - CONTRATO_POR_CHAVE.get(b.system_key).ordemPadrao);
  const personalizados = linhas
    .filter((linha) => linha.system_key === null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));

  await reordenarCamposRepository(
    tenantId,
    [...sistema, ...personalizados].map((linha) => linha.id),
  );
  await invalidarSchemaCampos(tenantId);
  return listarConfiguracaoCampos(tenantId);
}

function campoNaoEncontrado() {
  return erroNaoEncontrado('Campo não encontrado');
}
