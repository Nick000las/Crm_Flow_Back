/**
 * @file SERVICE: mudanças dos provedores para quem está com um quadro de entidade aberto (M5).
 * Quadro de entidade não tem membros: quem pode abrir é o provedor que diz, e o que cada um vê
 * continua nas rotas, com as permissões dele.
 */
import { AppError } from '#core/errors/app-error.js';
import { provedoresDeQuadro } from '#core/quadros/registro.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

import { DESPACHO_DE_QUADROS, KANBAN_FEATURES } from '../constants.js';
import { listarColunas } from './quadro-entidade.service.js';

/**
 * SERVICE: mudanças dos provedores para quem está com um quadro de entidade
 * aberto (M5). Quadro de entidade não tem membros: quem pode abrir é o provedor
 * que diz, e o que cada um vê continua nas rotas, com as permissões dele.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {{ tenantId: string, boardType: string, quadroRef: string, entidadeIds: string[] }} Mudanca
 */

/**
 * Só entra na sala quem consegue abrir o quadro: mesma flag e mesma regra das
 * rotas. Pipeline oculto para o papel recusa aqui.
 *
 * @param {TenantContext} context
 * @param {{ boardType: string, quadroRef: string }} quadro
 */
export async function autorizarQuadro(context, quadro) {
  if (!(await featureAtiva(context.tenantId, KANBAN_FEATURES.QUADROS_ENTIDADE))) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Quadros indisponíveis.',
    });
  }

  await listarColunas(context, quadro);
}

/**
 * Um aviso por quadro, sem repetir card: uma importação em lote não vira uma
 * mensagem por linha.
 *
 * @param {string} boardType
 * @param {{ tenantId: string, quadroRef: string, entidadeId: string }[]} eventos
 * @returns {Mudanca[]}
 */
export function agruparPorQuadro(boardType, eventos) {
  /** @type {Map<string, { tenantId: string, quadroRef: string, ids: Set<string> }>} */
  const quadros = new Map();

  for (const { tenantId, quadroRef, entidadeId } of eventos) {
    const chave = `${tenantId}:${quadroRef}`;

    if (!quadros.has(chave)) {
      quadros.set(chave, { tenantId, quadroRef, ids: new Set() });
    }

    quadros.get(chave).ids.add(entidadeId);
  }

  return [...quadros.values()].map(({ tenantId, quadroRef, ids }) => ({
    tenantId,
    boardType,
    quadroRef,
    entidadeIds: [...ids],
  }));
}

/**
 * Confirma só depois de emitir: se a emissão falhar, o evento volta quando a
 * reserva vencer.
 *
 * @param {(mudanca: Mudanca) => void} emitir
 */
export async function despacharEventos(emitir) {
  const provedores = provedoresDeQuadro().filter((provedor) => provedor.drenarEventos);

  for (const provedor of provedores) {
    for (let lote = 0; lote < DESPACHO_DE_QUADROS.MAX_LOTES; lote += 1) {
      const { ids, eventos } = await provedor.drenarEventos(DESPACHO_DE_QUADROS.LOTE);

      agruparPorQuadro(provedor.boardType, eventos).forEach(emitir);
      await provedor.confirmarEventos(ids);

      if (ids.length < DESPACHO_DE_QUADROS.LOTE) {
        break;
      }
    }
  }
}
