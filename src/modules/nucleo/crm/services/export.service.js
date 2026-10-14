import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { CAMADA, CAMADA_1_CAMPOS, CAMADA_2_CAMPOS, CAMPOS_EXTRAS_PLANILHA, EXPORTACAO } from '../constants.js';
import { buscarLeadsFiltrados, listarCamposDoTenant } from './leads.service.js';
import { gerarPlanilha } from './planilha.service.js';

/**
 * SERVICE: export síncrono — gera o .xlsx no próprio request e o
 * controller devolve o binário (decisão: sem storage de arquivo). O
 * limite de linhas protege a memória do processo HTTP.
 *
 * @typedef {{ chave: string, label: string, tipo: string, camada?: number }} CampoExportavel
 */

const SEPARADOR_LISTA = ', ';

/**
 * @param {string} tenantId
 * @param {{ colunas: string[], filtro?: import('./lead-filter.service.js').FiltroLeads }} input
 *   `colunas` são chaves de `GET /crm/leads/fields` (+ `valor`/`funilEstagio`), na ordem desejada.
 * @returns {Promise<Buffer>}
 */
export async function exportarLeads(tenantId, { colunas, filtro = {} }) {
  const campos = [...(await listarCamposDoTenant(tenantId)), ...CAMPOS_EXTRAS_PLANILHA];
  const campoPorChave = new Map(campos.map((campo) => [campo.chave, campo]));

  const desconhecidas = colunas.filter((chave) => !campoPorChave.has(chave));
  if (desconhecidas.length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Há colunas que não são campos ativos',
      fields: { colunas: desconhecidas.map((chave) => `"${chave}" não é um campo ativo`) },
    });
  }

  const { itens, total } = await buscarLeadsFiltrados(tenantId, filtro, {
    limite: EXPORTACAO.MAX_LINHAS,
    offset: 0,
  });
  if (total > EXPORTACAO.MAX_LINHAS) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `O filtro retorna ${total} leads — o export é limitado a ${EXPORTACAO.MAX_LINHAS}. Refine o filtro.`,
    });
  }

  const camposExportados = colunas.map((chave) => /** @type {CampoExportavel} */ (campoPorChave.get(chave)));
  return gerarPlanilha(
    camposExportados.map((campo) => campo.label),
    itens.map((lead) => camposExportados.map((campo) => valorParaPlanilha(lead, campo))),
  );
}

/**
 * @param {Record<string, any>} lead já formatado (Camada 2 desligada removida)
 * @param {CampoExportavel} campo
 */
export function valorParaPlanilha(lead, campo) {
  let valor;
  if (campo.chave === 'valor') valor = lead.valor;
  else if (campo.chave === 'funilEstagio') valor = lead.estagio_nome;
  else if (campo.camada === CAMADA.CAMADA_3) valor = lead.custom_fields?.[campo.chave];
  else valor = lead[CAMADA_1_CAMPOS[campo.chave] ?? CAMADA_2_CAMPOS[campo.chave]];

  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return valor.join(SEPARADOR_LISTA);
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  // NUMERIC chega como Prisma.Decimal.
  if (typeof valor === 'object' && typeof valor.toNumber === 'function') return valor.toNumber();
  if (campo.tipo === 'data' && typeof valor === 'string') {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? valor : data;
  }
  return valor;
}
