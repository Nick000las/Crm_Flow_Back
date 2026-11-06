import { AppError, erroNaoEncontrado } from '#core/errors/app-error.js';
import {
  provedorDaEntidade,
  provedorDoQuadro,
  provedoresDeQuadro,
} from '#core/quadros/registro.js';
import { moduloAtivo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { ACOES_CARD_ENTIDADE, MODOS_QUADRO } from '../constants.js';

/**
 * SERVICE: motor dos quadros de entidade (M2), cujo conteúdo vem do módulo
 * dono dos dados. Fica separado de `executar()` de propósito: nada aqui lê
 * ou grava tabela do Kanban, então os quadros nativos não mudam.
 *
 * O motor não guarda nada sobre esses quadros e só expõe o que o contrato
 * tem: não há rota para editar coluna nem para excluir card.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 */

/**
 * Sem provedor ou com o módulo dono não contratado, a resposta é a mesma:
 * para este tenant o quadro não existe.
 *
 * @param {TenantContext} context
 * @param {string} boardType
 */
async function provedorAcessivel(context, boardType) {
  const quadro = provedorDoQuadro(boardType);
  if (!quadro || !(await moduloAtivo(context.tenantId, quadro.modulo))) {
    throw erroNaoEncontrado('Quadro não encontrado.');
  }
  return quadro;
}

/**
 * Quadros que os provedores publicam para este usuário. Provedor com erro
 * fica de fora e não derruba a lista, que também traz os quadros nativos.
 *
 * @param {TenantContext} context
 * @param {{ warn: (dados: object, mensagem: string) => void }} logger
 */
export async function listarQuadrosDeEntidade(context, logger) {
  const resultados = await Promise.all(
    provedoresDeQuadro().map(async (provedor) => {
      try {
        if (!(await moduloAtivo(context.tenantId, provedor.modulo))) {
          return [];
        }
        const quadros = await provedor.listarQuadros(context);
        return quadros.map(({ quadroRef, nome }) => ({
          boardType: provedor.boardType,
          quadroRef,
          nome,
          modo: MODOS_QUADRO.ENTIDADE,
        }));
      } catch (erro) {
        logger.warn({ err: erro, boardType: provedor.boardType }, 'Provedor de quadro falhou.');
        return [];
      }
    }),
  );
  return resultados.flat();
}

/**
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string }} quadro
 */
export async function listarColunas(context, { boardType, quadroRef }) {
  const provedor = await provedorAcessivel(context, boardType);
  return provedor.listarColunas(context, quadroRef);
}

/**
 * Uma página de uma coluna. O provedor diz quais cards entram; a descrição
 * vem em lote do provedor da entidade. Registro sem descrição sai como
 * restrito, nunca com dado parcial.
 *
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string }} quadro
 * @param {{ colunaRef: string, filtros?: object, cursor?: string, limite: number }} consulta
 */
export async function listarCards(context, { boardType, quadroRef }, consulta) {
  const provedor = await provedorAcessivel(context, boardType);
  const { itens, proximoCursor } = await provedor.listarCards(context, quadroRef, consulta);

  const entidade = provedorDaEntidade(provedor.entidadeTipo);
  const descricoes = await entidade.descrever(
    context,
    itens.map((item) => item.entidadeId),
  );
  const porId = new Map(descricoes.map(({ id, ...descricao }) => [id, descricao]));

  return {
    itens: itens.map((item) => ({
      ...item,
      ...(porId.get(item.entidadeId) ?? { restrito: true }),
      rotaFicha: entidade.rotaFicha(item.entidadeId),
    })),
    proximoCursor: proximoCursor ?? null,
  };
}

/**
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string }} quadro
 * @param {{ colunaRef: string, filtros?: object }} consulta
 */
export async function resumirColuna(context, { boardType, quadroRef }, consulta) {
  const provedor = await provedorAcessivel(context, boardType);
  return provedor.resumoColuna(context, quadroRef, consulta);
}

/**
 * @param {TenantContext} context
 * @param {{ boardType: string, entidadeId: string }} card
 * @returns {Promise<string[]>}
 */
export async function listarAcoes(context, { boardType, entidadeId }) {
  const provedor = await provedorAcessivel(context, boardType);
  return provedor.acoesPermitidas(context, entidadeId);
}

/**
 * Mover é editar: o provedor aplica as regras do domínio e devolve
 * `CAMPOS_OBRIGATORIOS` se faltar algo. O motor só confere se a ação é
 * permitida a este usuário.
 *
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string, entidadeId: string }} card
 * @param {{ colunaDestino: string, expectedUpdatedAt?: string }} destino
 */
export async function moverCard(context, { boardType, quadroRef, entidadeId }, destino) {
  const provedor = await provedorAcessivel(context, boardType);
  const acoes = await provedor.acoesPermitidas(context, entidadeId);
  if (!acoes.includes(ACOES_CARD_ENTIDADE.MOVER)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Você não pode mover este card.',
    });
  }
  return provedor.mover(context, { quadroRef, entidadeId, ...destino });
}

/**
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string }} quadro
 * @param {{ colunaRef: string, dados: object }} novo
 */
export async function criarCard(context, { boardType, quadroRef }, novo) {
  const provedor = await provedorAcessivel(context, boardType);
  return provedor.criar(context, { quadroRef, ...novo });
}
