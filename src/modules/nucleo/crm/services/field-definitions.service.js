import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { slugify } from '#shared/text/slugify.js';
import {
  buscarDefinicoesPorTenant,
  buscarDefinicaoPorChave,
  criarDefinicao as criarDefinicaoRepository,
  atualizarDefinicao as atualizarDefinicaoRepository,
  reordenarDefinicoes as reordenarDefinicoesRepository,
  removerDefinicao as removerDefinicaoRepository,
} from '../adapters/field-definitions.repository.js';
import { FIELD_DEFINITION_TIPOS, TIPOS_COM_OPCOES } from '../constants.js';

/**
 * SERVICE: lógica de negócio pura. Nunca importa Fastify.
 * @typedef {import('../types/index.js').FieldDefinition} FieldDefinition
 * @typedef {import('../types/index.js').CriarFieldDefinitionInput} CriarFieldDefinitionInput
 * @typedef {import('../types/index.js').AtualizarFieldDefinitionInput} AtualizarFieldDefinitionInput
 */

/**
 * `tenantId` já saiu de um JWT validado por `authenticateHook` — a
 * existência do tenant foi garantida no login, não é responsabilidade
 * deste service reconfirmar isso a cada chamada (ver `leads.service.js`,
 * que segue o mesmo princípio).
 *
 * @param {string} tenantId
 * @returns {Promise<FieldDefinition[]>}
 */
export async function listarDefinicoesPorTenant(tenantId) {
  return buscarDefinicoesPorTenant(tenantId);
}

/**
 * @param {string} tenantId
 * @param {{ label: string, tipo: string, opcoes?: string[] | null, obrigatorio: boolean, ordem: number }} input
 * @returns {Promise<FieldDefinition>}
 */
export async function criarNovaDefinicao(tenantId, input) {
  const label = input?.label?.trim();

  if (!label) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Informe o nome do campo',
      fields: { label: ['Informe o nome do campo'] },
    });
  }

  const opcoes = validarTipoEOpcoes(input.tipo, input.opcoes);
  const chave = slugify(label);

  const definicaoExistente = await buscarDefinicaoPorChave(tenantId, chave);
  if (definicaoExistente) {
    throw new AppError({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Já existe um campo com esse nome',
      fields: { label: ['Já existe um campo com esse nome'] },
    });
  }

  return criarDefinicaoRepository(tenantId, {
    chave,
    label,
    tipo: input.tipo,
    opcoes,
    obrigatorio: Boolean(input.obrigatorio),
    ordem: input.ordem,
  });
}

/**
 * `chave` nunca é editável por aqui — ver comentário do adapter. Só
 * label/tipo/opcoes/obrigatorio.
 *
 * @param {string} tenantId
 * @param {string} definicaoId
 * @param {AtualizarFieldDefinitionInput} atualizacoes
 * @returns {Promise<FieldDefinition>}
 */
export async function editarDefinicao(tenantId, definicaoId, atualizacoes) {
  const opcoes = validarTipoEOpcoes(atualizacoes.tipo, atualizacoes.opcoes);

  const definicaoAtualizada = await atualizarDefinicaoRepository(tenantId, definicaoId, {
    label: atualizacoes.label,
    tipo: atualizacoes.tipo,
    opcoes,
    obrigatorio: Boolean(atualizacoes.obrigatorio),
  });

  // UPDATE ... RETURNING sem linha = id não existe (ou não é deste
  // tenant) — não precisa de uma query extra só pra checar antes.
  if (!definicaoAtualizada) {
    throw definicaoNaoEncontrada();
  }

  return definicaoAtualizada;
}

/**
 * @param {string} tenantId
 * @param {{ id: string, ordem: number }[]} definicoesOrdenadas
 * @returns {Promise<void>}
 */
export async function reordenarDefinicoesDoTenant(tenantId, definicoesOrdenadas) {
  return reordenarDefinicoesRepository(tenantId, definicoesOrdenadas);
}

/**
 * @param {string} tenantId
 * @param {string} definicaoId
 * @returns {Promise<{ removido: true, aviso: string }>}
 */
export async function removerDefinicao(tenantId, definicaoId) {
  const definicaoRemovida = await removerDefinicaoRepository(tenantId, definicaoId);

  if (!definicaoRemovida) {
    throw definicaoNaoEncontrada();
  }

  // Dado órfão de propósito (plano, Parte 1.4) — leads.custom_fields não é
  // tocado. O aviso mora aqui, não no controller, pra não virar texto
  // duplicado se algum outro caller chamar o service diretamente.
  return {
    removido: true,
    aviso: 'Dados já preenchidos com esta chave continuam salvos nos leads existentes.',
  };
}

/**
 * Validação compartilhada por criar/editar — evita duas cópias da mesma
 * regra divergindo com o tempo.
 *
 * @param {string} tipo
 * @param {string[] | null | undefined} opcoes
 * @returns {string[] | null}
 */
function validarTipoEOpcoes(tipo, opcoes) {
  if (!FIELD_DEFINITION_TIPOS.includes(tipo)) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Tipo de campo inválido',
      fields: { tipo: [`Tipo deve ser um de: ${FIELD_DEFINITION_TIPOS.join(', ')}`] },
    });
  }

  const precisaDeOpcoes = TIPOS_COM_OPCOES.includes(tipo);

  if (precisaDeOpcoes && (!opcoes || opcoes.length === 0)) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Informe as opções do campo',
      fields: { opcoes: ['Informe ao menos uma opção'] },
    });
  }

  // Tipo que não usa opções nunca guarda lixo em `opcoes`, mesmo que o
  // cliente mande algo por engano.
  return precisaDeOpcoes ? opcoes : null;
}

function definicaoNaoEncontrada() {
  return new AppError({
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.RESOURCE_NOT_FOUND,
    message: 'Definição de campo não encontrada',
  });
}
