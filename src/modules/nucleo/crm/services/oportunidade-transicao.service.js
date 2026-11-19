import { erroDeValidacao } from '#core/errors/app-error.js';
import { CATEGORIAS_STATUS } from '../constants.js';
import {
  CAMPOS_COMERCIAIS,
  EVENTOS_OPORTUNIDADE,
  LIMITES_OPORTUNIDADE,
} from '../constants/oportunidades.js';

/**
 * SERVICE (puro): o que muda quando uma oportunidade troca de status. Ganhar,
 * perder e reabrir são o mesmo caminho: quem define é a categoria da opção.
 *
 * @typedef {{ id?: string, key: string, label: string, category: string, ativo: boolean }} OpcaoDeStatus
 * @typedef {{
 *   status?: string | null, funilEstagioId?: string | null, valor?: number | null,
 *   probabilidadeFechamento?: number | null, dataPrevistaFechamento?: Date | null,
 *   motivoPerda?: string | null, dataConversao?: Date | null,
 * }} ComerciaisDoLead
 */

const EVENTO_DA_CATEGORIA = Object.freeze({
  [CATEGORIAS_STATUS.GANHO]: EVENTOS_OPORTUNIDADE.GANHA,
  [CATEGORIAS_STATUS.PERDIDO]: EVENTOS_OPORTUNIDADE.PERDIDA,
});

/** Avisos que a resposta de uma mudança de status pode trazer (FC1). */
export const AVISOS_OPORTUNIDADE = Object.freeze({
  PROBABILIDADE_REDEFINIDA: 'PROBABILIDADE_REDEFINIDA',
});

/**
 * Probabilidade que vale no forecast (FC1): a da oportunidade, se preenchida;
 * senão, a padrão do status.
 *
 * @param {number | null | undefined} override
 * @param {number | null | undefined} padrao
 * @returns {number | null}
 */
export function probabilidadeEfetiva(override, padrao) {
  if (override !== null && override !== undefined) return Number(override);
  return padrao === null || padrao === undefined ? null : Number(padrao);
}

/**
 * Avisos do plano para a resposta. Hoje só um: a probabilidade da oportunidade
 * voltou à padrão do novo status.
 *
 * @param {{ probabilidadeRedefinida?: number | null } | null | undefined} plano
 * @returns {{ codigo: string, campo: string, anterior: number }[]}
 */
export function avisosDoPlano(plano) {
  const anterior = plano?.probabilidadeRedefinida;
  if (anterior === null || anterior === undefined) return [];
  return [
    {
      codigo: AVISOS_OPORTUNIDADE.PROBABILIDADE_REDEFINIDA,
      campo: 'probabilidadeFechamento',
      anterior,
    },
  ];
}

/**
 * @param {Record<string, any>} deal  linha atual
 * @param {OpcaoDeStatus} opcao  status de destino, do pipeline da oportunidade
 * @param {{ motivoPerda?: string | null }} dados
 * @param {Date} agora
 */
export function planejarStatus(deal, opcao, { motivoPerda }, agora) {
  const destino = opcao.category;
  const origem = deal.status_category;
  const mudouCategoria = origem !== destino;
  const perdida = destino === CATEGORIAS_STATUS.PERDIDO;
  const reabriu = origem !== CATEGORIAS_STATUS.ABERTO && destino === CATEGORIAS_STATUS.ABERTO;

  /** @type {Record<string, unknown>} */
  const mudancas = {
    status: opcao.key,
    status_category: destino,
    // Data de quando entrou na categoria: mudar de Ganho para outro status de ganho não troca.
    won_at: destino === CATEGORIAS_STATUS.GANHO ? (mudouCategoria ? agora : deal.won_at) : null,
    lost_at: perdida ? (mudouCategoria ? agora : deal.lost_at) : null,
    lost_reason: perdida ? (motivoPerda === undefined ? deal.lost_reason : motivoPerda) : null,
  };

  const statusMudou = deal.status !== opcao.key;
  // Override esquecido de uma etapa anterior é a maior fonte de forecast
  // inflado: trocar o status volta à probabilidade padrão do novo (FC1).
  const override = deal.probability_override ?? null;
  if (statusMudou) mudancas.probability_override = null;
  const evento =
    (mudouCategoria && EVENTO_DA_CATEGORIA[destino]) ||
    (reabriu ? EVENTOS_OPORTUNIDADE.REABERTA : EVENTOS_OPORTUNIDADE.STATUS_MUDOU);

  return {
    mudancas,
    evento,
    statusMudou,
    statusAnterior: deal.status,
    probabilidadeRedefinida: statusMudou && override !== null ? Number(override) : null,
    ganhou: mudouCategoria && destino === CATEGORIAS_STATUS.GANHO,
    // Só venda ganha tem atendimento nascido dela para avisar.
    reabriu: reabriu && origem === CATEGORIAS_STATUS.GANHO,
  };
}

/** Para comparar: `Decimal` do driver vira número, `Date` vira texto. */
function normalizar(valor) {
  if (valor === undefined || valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  return typeof valor === 'object' ? Number(valor) : valor;
}

/**
 * Entradas do diff do histórico, nas chaves da API do lead.
 *
 * @param {Record<string, any>} deal
 * @param {Record<string, unknown>} mudancas
 * @param {Readonly<Record<string, string>>} campoDaColuna  coluna → chave no histórico
 */
export function diffDaOportunidade(deal, mudancas, campoDaColuna) {
  return Object.entries(campoDaColuna).flatMap(([coluna, campo]) => {
    if (!(coluna in mudancas)) return [];
    const antes = normalizar(deal[coluna]);
    const depois = normalizar(mudancas[coluna]);
    return antes === depois ? [] : [{ campo, antes, depois }];
  });
}

/**
 * Opção de destino. Inativa só vale se a oportunidade já estiver nela.
 *
 * @param {OpcaoDeStatus[]} opcoes
 * @param {string} status
 * @param {string} [statusAtual]
 * @returns {OpcaoDeStatus}
 */
export function opcaoDoStatus(opcoes, status, statusAtual) {
  const opcao = opcoes.find((item) => item.key === status);
  if (!opcao || (!opcao.ativo && status !== statusAtual)) {
    throw erroDeValidacao('status', `"${status}" não é uma opção de Status deste pipeline`);
  }
  return opcao;
}

/** @param {OpcaoDeStatus[]} opcoes */
export function primeiroStatusAberto(opcoes) {
  return opcoes.find((opcao) => opcao.ativo && opcao.category === CATEGORIAS_STATUS.ABERTO);
}

/**
 * Separa o que vai para a oportunidade do que fica no contato, só com as chaves
 * que vieram (omitir mantém, `null` limpa).
 *
 * @param {Record<string, any>} dados
 * @returns {{ comerciais: ComerciaisDoLead, contato: Record<string, any> }}
 */
export function separarComerciais(dados) {
  const comerciais = {};
  const contato = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (valor === undefined) continue;
    (CAMPOS_COMERCIAIS.includes(chave) ? comerciais : contato)[chave] = valor;
  }
  return { comerciais, contato };
}

/**
 * O que o lead aceitava e a oportunidade não aceita vira 400 no campo, em vez de
 * erro de banco. Toda oportunidade tem status.
 *
 * @param {ComerciaisDoLead} comerciais
 */
export function validarComerciais({ status, valor, probabilidadeFechamento }) {
  if (status === null) throw erroDeValidacao('status', 'O status não pode ser limpo');
  if (typeof valor === 'number' && (valor < 0 || valor > LIMITES_OPORTUNIDADE.VALOR_MAXIMO)) {
    throw erroDeValidacao('valor', 'Informe um valor entre zero e o limite aceito');
  }
  if (
    typeof probabilidadeFechamento === 'number' &&
    (!Number.isInteger(probabilidadeFechamento) ||
      probabilidadeFechamento < 0 ||
      probabilidadeFechamento > LIMITES_OPORTUNIDADE.PROBABILIDADE_MAXIMA)
  ) {
    throw erroDeValidacao(
      'probabilidadeFechamento',
      `Informe um número inteiro de 0 a ${LIMITES_OPORTUNIDADE.PROBABILIDADE_MAXIMA}`,
    );
  }
}

/**
 * `funilEstagioId` é o id da opção de status, como a leitura devolve. Vindo os
 * dois, vale `status`.
 *
 * @param {OpcaoDeStatus[]} opcoes
 * @param {ComerciaisDoLead} comerciais
 * @param {string} [statusAtual]
 * @returns {OpcaoDeStatus | null}
 */
function opcaoPedida(opcoes, { status, funilEstagioId }, statusAtual) {
  if (status) return opcaoDoStatus(opcoes, status, statusAtual);
  if (!funilEstagioId) return null;
  const opcao = opcoes.find((item) => item.id === funilEstagioId);
  if (!opcao) throw erroDeValidacao('funilEstagioId', 'Escolha um estágio deste pipeline');
  return opcaoDoStatus(opcoes, opcao.key, statusAtual);
}

/**
 * @param {Date | null | undefined} dataConversao
 * @param {string} categoria  a da oportunidade depois da mudança
 */
function garantirDataDeConversao(dataConversao, categoria) {
  if (dataConversao && categoria !== CATEGORIAS_STATUS.GANHO) {
    throw erroDeValidacao('dataConversao', 'A data de conversão só vale para oportunidade ganha');
  }
}

/**
 * A oportunidade de um lead novo. Sem status, o primeiro aberto do pipeline.
 *
 * @param {OpcaoDeStatus[]} opcoes
 * @param {ComerciaisDoLead} comerciais
 */
export function novaOportunidadeDoLead(opcoes, comerciais) {
  const opcao = opcaoPedida(opcoes, comerciais) ?? primeiroStatusAberto(opcoes);
  if (!opcao) throw erroDeValidacao('status', 'Este pipeline não tem status aberto ativo');
  garantirDataDeConversao(comerciais.dataConversao, opcao.category);
  return {
    status: opcao.key,
    categoria: opcao.category,
    valor: comerciais.valor,
    probabilidade: comerciais.probabilidadeFechamento,
    dataPrevista: comerciais.dataPrevistaFechamento,
    motivoPerda: comerciais.motivoPerda,
    ganhaEm: comerciais.dataConversao,
  };
}

/**
 * Edição vinda de `/crm/leads` sobre a oportunidade principal. `null` = nada a
 * gravar. Trocar de status segue `planejarStatus`; o resto é campo a campo. A
 * data de conversão limpa não apaga o ganho: isso é reabrir a venda.
 *
 * @param {Record<string, any>} deal
 * @param {OpcaoDeStatus[]} opcoes
 * @param {ComerciaisDoLead & { usuarioResponsavelId?: string | null }} dados
 * @param {Date} agora
 */
export function planejarEdicaoDoLead(deal, opcoes, dados, agora) {
  const opcao = opcaoPedida(opcoes, dados, deal.status);
  const base = opcao ? planejarStatus(deal, opcao, dados, agora) : { mudancas: {} };
  garantirDataDeConversao(dados.dataConversao, opcao?.category ?? deal.status_category);

  const campos = {
    amount: dados.valor,
    probability_override: dados.probabilidadeFechamento,
    expected_close_date: dados.dataPrevistaFechamento,
    owner_id: dados.usuarioResponsavelId,
    lost_reason: opcao ? undefined : dados.motivoPerda,
    won_at: dados.dataConversao ?? undefined,
  };
  const mudancas = {
    ...base.mudancas,
    ...Object.fromEntries(Object.entries(campos).filter(([, valor]) => valor !== undefined)),
  };
  const mudou = Object.entries(mudancas).some(
    ([coluna, valor]) => normalizar(deal[coluna]) !== normalizar(valor),
  );
  if (!mudou) return null;
  return {
    ...base,
    mudancas,
    // A probabilidade mandada junto com o status vence: o usuário acabou de escolher.
    probabilidadeRedefinida:
      dados.probabilidadeFechamento === undefined ? (base.probabilidadeRedefinida ?? null) : null,
    evento: base.statusMudou ? base.evento : EVENTOS_OPORTUNIDADE.ATUALIZADA,
  };
}
