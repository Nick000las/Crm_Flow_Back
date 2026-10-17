import { erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import {
  atualizarAtividade,
  buscarAtividade,
  criarAtividade,
  excluirAtividade,
  listarAtividadesDoLead,
} from '../adapters/crm-activities.repository.js';
import { TIPOS_LISTA } from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';

/**
 * SERVICE: atividades do lead (M6) — ligação, reunião, tarefa... O `tipo`
 * é a key de uma opção da lista "Tipo de atividade" (M3): só opção ativa,
 * a não ser que a atividade já tivesse esse tipo (mesma regra do lead).
 *
 * Concluir (`concluida: true`) grava a data da conclusão e atualiza a
 * última interação do lead; reabrir (`false`) limpa a conclusão, mas não
 * volta a data do lead.
 *
 * @typedef {import('../adapters/crm-activities.repository.js').AtividadeLinha} AtividadeLinha
 * @typedef {{ tipo: string, titulo: string, notas?: string | null, agendadaPara?: Date | null, concluida?: boolean }} NovaAtividade
 * @typedef {Partial<NovaAtividade>} EdicaoAtividade
 */

/** @param {AtividadeLinha} linha */
function formatarAtividade(linha) {
  return {
    id: linha.id,
    leadId: linha.lead_id,
    tipo: linha.tipo,
    titulo: linha.titulo,
    notas: linha.notas,
    agendadaPara: linha.agendada_para,
    concluidaEm: linha.concluida_em,
    autor: linha.autor_id ? { id: linha.autor_id, nome: linha.autor_nome } : null,
    criadoEm: linha.created_at,
    atualizadoEm: linha.updated_at,
  };
}

/**
 * @param {string} tenantId
 * @param {string} tipo
 * @param {string} [tipoAtual] o que a atividade já tinha (pode estar inativo)
 */
async function validarTipo(tenantId, tipo, tipoAtual) {
  const { listas } = await obterSchemaCampos(tenantId);
  const opcao = (listas[TIPOS_LISTA.TIPO_ATIVIDADE] ?? []).find((item) => item.key === tipo);
  if (!opcao) throw erroDeValidacao('tipo', `"${tipo}" não é um tipo de atividade`);
  if (!opcao.ativo && tipo !== tipoAtual) {
    throw erroDeValidacao('tipo', `O tipo "${opcao.label}" está desativado`);
  }
}

/**
 * Opções da lista "Tipo de atividade" pro formulário, na ordem configurada
 * — todas, com `ativo`, pra atividade antiga mostrar o selo de inativa.
 * Mesma ideia de `opcoesLista` em `GET /crm/leads/fields`: quem usa a lista
 * não depende da flag da tela de Listas (`crm.listas`).
 *
 * @param {string} tenantId
 */
export async function listarTiposDeAtividade(tenantId) {
  const { listas } = await obterSchemaCampos(tenantId);
  return (listas[TIPOS_LISTA.TIPO_ATIVIDADE] ?? []).map(({ key, label, color, ativo }) => ({ key, label, color, ativo }));
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 */
export async function listarAtividades(tenantId, leadId) {
  const linhas = await listarAtividadesDoLead(tenantId, leadId);
  if (!linhas) throw leadNaoEncontrado();
  return linhas.map(formatarAtividade);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {NovaAtividade} input
 * @param {string} [usuarioId] autor (do token)
 */
export async function registrarAtividade(tenantId, leadId, input, usuarioId) {
  await validarTipo(tenantId, input.tipo);
  const criada = await criarAtividade(tenantId, leadId, {
    tipo: input.tipo,
    titulo: input.titulo,
    notas: input.notas ?? null,
    agendadaPara: input.agendadaPara ?? null,
    concluidaEm: input.concluida ? new Date() : null,
    autorId: usuarioId ?? null,
  });
  if (!criada) throw leadNaoEncontrado();
  return formatarAtividade(criada);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} atividadeId
 * @param {EdicaoAtividade} input
 */
export async function editarAtividade(tenantId, leadId, atividadeId, input) {
  const atual = await buscarAtividade(tenantId, leadId, atividadeId);
  if (!atual) throw atividadeNaoEncontrada();
  if (input.tipo !== undefined) await validarTipo(tenantId, input.tipo, atual.tipo);

  const { concluida, ...campos } = input;
  /** @type {Record<string, unknown>} */
  const dados = { ...campos };
  // Concluir de novo o que já está concluído não muda a data.
  if (concluida === true && !atual.concluida_em) dados.concluidaEm = new Date();
  if (concluida === false) dados.concluidaEm = null;

  const editada = await atualizarAtividade(tenantId, leadId, atividadeId, dados);
  if (!editada) throw atividadeNaoEncontrada();
  return formatarAtividade(editada);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} atividadeId
 */
export async function removerAtividade(tenantId, leadId, atividadeId) {
  if (!(await excluirAtividade(tenantId, leadId, atividadeId))) throw atividadeNaoEncontrada();
  return { removido: true };
}

function leadNaoEncontrado() {
  return erroNaoEncontrado('Lead não encontrado');
}

function atividadeNaoEncontrada() {
  return erroNaoEncontrado('Atividade não encontrada');
}
