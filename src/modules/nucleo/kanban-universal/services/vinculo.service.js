import { erroNaoEncontrado } from '#core/errors/app-error.js';
import { provedorDaEntidade } from '#core/quadros/registro.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { moduloAtivo } from '#core/tenant/module-access.js';
import { buscarCardsVinculados } from '../adapters/vinculos.repository.js';
import { KANBAN_FEATURES } from '../constants.js';
import { operarKanban } from './kanban.service.js';

/**
 * SERVICE: vínculo de card de projeto com um registro de outro módulo (M6).
 * O Kanban guarda só tipo e id. Nome e link vêm do provedor a cada leitura,
 * então mudar ou anonimizar no módulo dono vale na hora. Registro que o
 * provedor não descreve sai como restrito, sem nenhum dado.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {{ warn: (dados: object, mensagem: string) => void }} Logger
 */

const CARD_COM_VINCULO = new Set(['card.get', 'card.link']);

/**
 * @param {TenantContext} context
 * @param {string} tipo
 * @returns provedor, ou `undefined` sem provedor ou sem o módulo dono contratado
 */
async function provedorAcessivel(context, tipo) {
  const provedor = provedorDaEntidade(tipo);
  // D3: quem publica um registro decide se card de projeto pode apontar para ele.
  if (
    !provedor ||
    provedor.vinculavel === false ||
    !(await moduloAtivo(context.tenantId, provedor.modulo))
  ) {
    return undefined;
  }
  return provedor;
}

const chave = (tipo, id) => `${tipo}:${id}`;

/**
 * Uma chamada por tipo, em lote. Provedor com erro não derruba o quadro: os
 * vínculos dele saem como restritos.
 *
 * @param {TenantContext} context
 * @param {{ tipo: string, id: string }[]} vinculos
 * @param {Logger} logger
 * @returns {Promise<Map<string, object>>}
 */
async function descreverVinculos(context, vinculos, logger) {
  const idsPorTipo = new Map();
  for (const { tipo, id } of vinculos) {
    idsPorTipo.set(tipo, new Set(idsPorTipo.get(tipo)).add(id));
  }

  const descricoes = new Map();
  await Promise.all(
    [...idsPorTipo].map(async ([tipo, ids]) => {
      try {
        const provedor = await provedorAcessivel(context, tipo);
        const lista = provedor ? await provedor.descrever(context, [...ids]) : [];
        for (const { id, idAtual, ...descricao } of lista) {
          const atual = idAtual ?? id;
          descricoes.set(chave(tipo, id), {
            tipo,
            id: atual,
            ...descricao,
            rotaFicha: provedor.rotaFicha(atual),
          });
        }
      } catch (erro) {
        logger.warn({ err: erro, tipo }, 'Provedor de entidade falhou.');
      }
    }),
  );
  return descricoes;
}

/** @param {string} action @param {any} valor os cards que a resposta carrega */
function cardsDaResposta(action, valor) {
  return action === 'board.get' ? valor.colunas.flatMap((coluna) => coluna.cards) : [valor];
}

/**
 * Troca a referência crua de `board.get` e `card.get` pelo vínculo legível.
 * Flag desligada: a resposta sai sem o campo, como antes do M6.
 *
 * @param {TenantContext} context
 * @param {string} action
 * @param {any} valor
 * @param {Logger} logger
 */
export async function apresentarVinculos(context, action, valor, logger) {
  if (!valor || (action !== 'board.get' && !CARD_COM_VINCULO.has(action))) {
    return valor;
  }
  const ligado = await featureAtiva(context.tenantId, KANBAN_FEATURES.VINCULO_ENTIDADE);
  const referencias = ligado
    ? cardsDaResposta(action, valor).flatMap((card) => card.vinculo ?? [])
    : [];
  const descricoes = await descreverVinculos(context, referencias, logger);

  const apresentar = ({ vinculo, ...card }) => {
    if (!ligado) {
      return card;
    }
    const legivel =
      vinculo &&
      (descricoes.get(chave(vinculo.tipo, vinculo.id)) ?? {
        tipo: vinculo.tipo,
        restrito: true,
      });
    return { ...card, vinculo: legivel ?? null };
  };

  if (action !== 'board.get') {
    return apresentar(valor);
  }
  return {
    ...valor,
    colunas: valor.colunas.map((coluna) => ({ ...coluna, cards: coluna.cards.map(apresentar) })),
  };
}

/**
 * Só se vincula o que o usuário enxerga; o id gravado é o atual, para não
 * nascer apontando para um registro mesclado.
 *
 * @param {TenantContext} context
 * @param {string} cardId
 * @param {{ entidadeTipo: string, entidadeId: string }} entidade
 * @param {(evento: object) => Promise<void>} publish
 * @param {Logger} logger
 */
export async function vincularCard(context, cardId, { entidadeTipo, entidadeId }, publish, logger) {
  const provedor = await provedorAcessivel(context, entidadeTipo);
  const [descricao] = provedor ? await provedor.descrever(context, [entidadeId]) : [];
  if (!descricao) {
    throw erroNaoEncontrado('Registro não encontrado.');
  }
  const valor = await operarKanban(
    context,
    'card.link',
    cardId,
    { entidadeTipo, entidadeId: descricao.idAtual ?? entidadeId },
    publish,
  );
  return apresentarVinculos(context, 'card.link', valor, logger);
}

/**
 * @param {TenantContext} context
 * @param {string} cardId
 * @param {(evento: object) => Promise<void>} publish
 */
export async function desvincularCard(context, cardId, publish) {
  await operarKanban(context, 'card.link', cardId, {}, publish);
}

/**
 * Aba "Projetos" da ficha: só cards de quadros que o usuário vê. Registro que
 * ele não enxerga responde vazio, e a tela esconde a aba.
 *
 * @param {TenantContext} context
 * @param {{ entidadeTipo: string, entidadeId: string }} entidade
 */
export async function listarCardsDaEntidade(context, { entidadeTipo, entidadeId }) {
  const provedor = await provedorAcessivel(context, entidadeTipo);
  const [descricao] = provedor ? await provedor.descrever(context, [entidadeId]) : [];
  return descricao
    ? buscarCardsVinculados(context, {
        entidadeTipo,
        entidadeId: descricao.idAtual ?? entidadeId,
      })
    : [];
}
