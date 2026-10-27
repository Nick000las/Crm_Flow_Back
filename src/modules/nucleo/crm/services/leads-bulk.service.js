import { AppError, erroNaoEncontrado } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { atualizarLeadExistente } from './leads.service.js';
import { buscadorDeTags } from './listas.service.js';
import { TIPOS_LISTA } from '../constants.js';

/**
 * SERVICE: edição em massa (M10, `PATCH /crm/leads/bulk`).
 *
 * Cada lead passa pelo mesmo caminho do PUT (`atualizarLeadExistente`):
 * opção ativa, responsável ativo, regras do M8 contra o lead resultante,
 * histórico e `ultima_interacao_em` ao mudar o status. Um lead que falha
 * não para os outros — vai pro relatório com o erro. Só o que muda de
 * verdade em cada lead entra no PUT; sem mudança, o lead sai `inalterado`
 * (sem evento no histórico).
 *
 * @typedef {{
 *   status?: string,
 *   fonteLead?: string,
 *   usuarioResponsavelId?: string | null,
 *   tags?: { adicionar?: string[], remover?: string[] },
 * }} AlteracoesEmMassa
 * @typedef {{
 *   id: string,
 *   ok: boolean,
 *   inalterado?: boolean,
 *   erro?: { statusCode: number, code: string, message: string, fields?: Record<string, string[]> },
 * }} ResultadoEmMassa
 */

/**
 * @param {string} tenantId
 * @param {{ ids: string[], alteracoes: AlteracoesEmMassa }} entrada
 * @param {string} [usuarioId]
 * @param {{ papel?: string }} [acesso]  M13: campo que o papel não edita → 403 pro pedido inteiro
 */
export async function editarLeadsEmMassa(tenantId, { ids, alteracoes }, usuarioId, acesso = {}) {
  const schema = await obterSchemaDoPapel(tenantId, acesso.papel);
  // Uma vez, antes de mexer em qualquer lead (e não o mesmo 403 repetido no relatório).
  garantirEscritaPermitida(schema, {
    status: alteracoes.status,
    fonteLead: alteracoes.fonteLead,
    tags: alteracoes.tags,
  });
  const { listas } = schema;
  const encontrarTag = buscadorDeTags(listas[TIPOS_LISTA.TAG] ?? []);

  /** @type {ResultadoEmMassa[]} */
  const resultados = [];
  for (const id of ids) {
    try {
      const atual = await buscarLeadPorId(tenantId, id);
      if (!atual) throw erroNaoEncontrado('Lead não encontrado');

      const input = alteracoesDoLead(atual, alteracoes, encontrarTag);
      if (Object.keys(input).length === 0) {
        resultados.push({ id, ok: true, inalterado: true });
        continue;
      }
      await atualizarLeadExistente(tenantId, id, input, usuarioId, acesso);
      resultados.push({ id, ok: true });
    } catch (erro) {
      resultados.push({ id, ok: false, erro: erroDoRelatorio(erro) });
    }
  }

  const falhas = resultados.filter((resultado) => !resultado.ok).length;
  const inalterados = resultados.filter((resultado) => resultado.inalterado).length;
  return {
    total: ids.length,
    atualizados: ids.length - falhas - inalterados,
    inalterados,
    falhas,
    resultados,
  };
}

/**
 * Função pura: o payload do PUT pra um lead, só com o que muda nele.
 * Tags: as do lead, menos as removidas, mais as adicionadas (texto de tag
 * nova vai como texto e vira opção no PUT, como no formulário).
 *
 * @param {Record<string, any>} atual  linha do lead
 * @param {AlteracoesEmMassa} alteracoes
 * @param {(texto: string) => { key: string } | undefined} encontrarTag
 * @returns {Record<string, unknown>}
 */
export function alteracoesDoLead(atual, { status, fonteLead, usuarioResponsavelId, tags }, encontrarTag) {
  /** @type {Record<string, unknown>} */
  const input = {};
  if (status !== undefined && status !== atual.status) input.status = status;
  if (fonteLead !== undefined && fonteLead !== atual.fonte_lead) input.fonteLead = fonteLead;
  if (usuarioResponsavelId !== undefined && usuarioResponsavelId !== atual.usuario_responsavel_id) {
    input.usuarioResponsavelId = usuarioResponsavelId;
  }

  if (tags) {
    const atuais = /** @type {string[]} */ (atual.tags ?? []);
    const removidas = new Set(
      (tags.remover ?? []).map((texto) => encontrarTag(texto)?.key).filter((key) => key !== undefined),
    );
    const keys = atuais.filter((key) => !removidas.has(key));
    /** @type {string[]} */
    const novas = [];
    for (const texto of tags.adicionar ?? []) {
      const key = encontrarTag(texto)?.key;
      if (key === undefined) novas.push(texto);
      else if (!keys.includes(key)) keys.push(key);
    }
    const mudou = novas.length > 0 || keys.length !== atuais.length || keys.some((key) => !atuais.includes(key));
    if (mudou) input.tags = [...keys, ...novas];
  }
  return input;
}

/**
 * Só erro de negócio (`AppError`) vai com a mensagem; o resto sai genérico,
 * como no relatório do import — detalhe de banco não vaza.
 *
 * @param {unknown} erro
 */
function erroDoRelatorio(erro) {
  if (erro instanceof AppError) {
    return {
      statusCode: erro.statusCode,
      code: erro.code,
      message: erro.message,
      ...(erro.fields ? { fields: erro.fields } : {}),
    };
  }
  return {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Não foi possível atualizar este lead',
  };
}
