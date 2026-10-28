import { Prisma } from '@prisma/client';
import { erroDeValidacao } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { slugify } from '#shared/text/slugify.js';
import {
  buscarProgressoRecalculo,
  contarLeadsDoTenant,
  gravarScores,
  gravarScoresEmLote,
  listarFaixasScore,
  listarRegrasScore,
  registrarProgressoRecalculo,
  salvarRegrasEFaixas,
} from '../adapters/crm-score.repository.js';
import { CHAVE_CAMPO_SCORE, CONTEXTOS_VISIBILIDADE, CRM_FEATURES, FAIXAS_SCORE_PADRAO, LIMITES_SCORE } from '../constants.js';
import { atualizarConfiguracaoCampo, listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { condicaoDoCampo, erroDeFiltro } from './lead-filter.service.js';

/**
 * SERVICE: pontuação de leads (M14). O score é o campo nativo "Lead score"
 * (`lead_score`): com a flag `crm.score` ligada, a soma dos pontos das
 * regras que casam, só leitura; desligada, um número manual como antes.
 *
 * O cálculo é UMA expressão SQL (`expressaoDoScore`) montada com a mesma
 * tradução de condição do filtro (`condicaoDoCampo`) — a mesma ao salvar um
 * lead e no recálculo em lote, então os dois nunca divergem, e o resultado
 * é determinístico (recalcular de novo dá o mesmo: idempotente).
 *
 * @typedef {import('../adapters/crm-score.repository.js').RegraScoreLinha} RegraScoreLinha
 * @typedef {import('../adapters/crm-score.repository.js').FaixaScoreLinha} FaixaScoreLinha
 * @typedef {{ id: string | null, chave: string, label: string, tipo: string, camada: number }} CampoDoSchema
 */

const OPERADORES_SEM_VALOR = new Set(['vazio', 'nao_vazio']);

/**
 * Soma dos pontos das regras ativas que casam, em SQL sobre `l` (leads).
 * Regra cujo campo de condição sumiu (excluído/desligado) ou cuja condição
 * deixou de valer pro tipo do campo é ignorada — nunca derruba o salvar.
 *
 * @param {Pick<RegraScoreLinha, 'ativo' | 'pontos' | 'condicoes'>[]} regras
 * @param {CampoDoSchema[]} campos
 * @returns {Prisma.Sql}
 */
export function expressaoDoScore(regras, campos) {
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));
  const parcelas = regras.flatMap((regra) => {
    if (!regra.ativo) return [];
    try {
      const condicoes = regra.condicoes.map(({ campoId, operador, valor }) => {
        const campo = campoPorId.get(campoId);
        if (!campo || campo.chave === CHAVE_CAMPO_SCORE) throw new Error('campo indisponível');
        return condicaoDoCampo(campo, { chave: campo.chave, operador, valor });
      });
      const casa = condicoes.length > 0 ? Prisma.join(condicoes, ' AND ') : Prisma.sql`TRUE`;
      return [Prisma.sql`CASE WHEN ${casa} THEN ${regra.pontos}::int ELSE 0 END`];
    } catch {
      return [];
    }
  });
  return parcelas.length > 0 ? Prisma.join(parcelas, ' + ') : Prisma.sql`0`;
}

/**
 * A expressão do tenant — `null` com a flag desligada (score manual).
 *
 * @param {string} tenantId
 * @returns {Promise<Prisma.Sql | null>}
 */
async function expressaoDoTenant(tenantId) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.SCORE))) return null;
  const [regras, { campos }] = await Promise.all([listarRegrasScore(tenantId), obterSchemaCampos(tenantId)]);
  return expressaoDoScore(regras, campos);
}

/**
 * Depois de gravar leads (criar, editar, massa, import, mesclagem,
 * enriquecimento): recalcula o score deles. `null` = flag desligada.
 *
 * @param {string} tenantId
 * @param {string[]} leadIds
 * @returns {Promise<Map<string, unknown> | null>}
 */
export async function recalcularScoreDosLeads(tenantId, leadIds) {
  const expressao = await expressaoDoTenant(tenantId);
  if (!expressao) return null;
  return gravarScores(tenantId, expressao, leadIds);
}

/**
 * Todos os leads do tenant, em lotes, gravando o progresso a cada lote
 * (consultável em `GET /crm/configuracoes/score` enquanto roda).
 *
 * @param {string} tenantId
 * @returns {Promise<{ total: number, processados: number }>}
 */
export async function recalcularTodos(tenantId) {
  const expressao = await expressaoDoTenant(tenantId);
  if (!expressao) return { total: 0, processados: 0 };

  const total = await contarLeadsDoTenant(tenantId);
  await registrarProgressoRecalculo(tenantId, { total, processados: 0, inicio: true });
  let processados = 0;
  let cursor = null;
  for (;;) {
    const ids = await gravarScoresEmLote(tenantId, expressao, cursor, LIMITES_SCORE.LOTE_RECALCULO);
    if (ids.length === 0) break;
    processados += ids.length;
    cursor = ids[ids.length - 1];
    await registrarProgressoRecalculo(tenantId, { total: Math.max(total, processados), processados });
    if (ids.length < LIMITES_SCORE.LOTE_RECALCULO) break;
  }
  await registrarProgressoRecalculo(tenantId, { total: Math.max(total, processados), processados, concluido: true });
  return { total: Math.max(total, processados), processados };
}

/**
 * Com a flag ligada o score é calculado: `leadScore` no payload → 400.
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} input
 */
export async function garantirScoreNaoEditado(tenantId, input) {
  if (input[CHAVE_CAMPO_SCORE] === undefined) return;
  if (await featureAtiva(tenantId, CRM_FEATURES.SCORE)) {
    throw erroDeValidacao(CHAVE_CAMPO_SCORE, 'O Lead score é calculado pelas regras de pontuação e não pode ser editado');
  }
}

// ---------------------------------------------------------------------------
// Faixas
// ---------------------------------------------------------------------------

/**
 * As do tenant, ou as padrão (Frio/Morno/Quente).
 *
 * @param {string} tenantId
 * @returns {Promise<FaixaScoreLinha[]>}
 */
export async function obterFaixas(tenantId) {
  const salvas = await listarFaixasScore(tenantId);
  return salvas.length > 0 ? salvas : FAIXAS_SCORE_PADRAO.map((faixa) => ({ ...faixa }));
}

/**
 * A faixa de um score (puro) — `null` sem score ou fora de toda faixa.
 *
 * @param {FaixaScoreLinha[]} faixas
 * @param {number | string | { toString(): string } | null | undefined} score
 */
export function faixaDoScore(faixas, score) {
  if (score === null || score === undefined) return null;
  // NUMERIC chega como Decimal do Prisma.
  const valor = Number(score);
  return (
    faixas.find(
      (faixa) => (faixa.minimo === null || valor >= faixa.minimo) && (faixa.maximo === null || valor <= faixa.maximo),
    ) ?? null
  );
}

/**
 * Filtro `faixaScore` (chave da faixa) → limites. Exige a flag. Faixa
 * apagada (view salva antes) → 400 em `filtros.faixaScore`, como os outros filtros.
 *
 * @param {string} tenantId
 * @param {string} chave
 * @returns {Promise<{ minimo: number | null, maximo: number | null }>}
 */
export async function limitesDaFaixa(tenantId, chave) {
  const faixa = (await obterFaixas(tenantId)).find((item) => item.chave === chave);
  if (!faixa) throw erroDeFiltro('faixaScore', `"${chave}" não é uma faixa de score`);
  return { minimo: faixa.minimo, maximo: faixa.maximo };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * GET /crm/configuracoes/score: regras, faixas (as padrão se nunca salvou)
 * e o progresso do último recálculo.
 *
 * @param {string} tenantId
 */
export async function obterConfigScore(tenantId) {
  const [regras, faixasSalvas, progresso] = await Promise.all([
    listarRegrasScore(tenantId),
    listarFaixasScore(tenantId),
    buscarProgressoRecalculo(tenantId),
  ]);
  return {
    regras: regras.map(({ id, nome, ativo, pontos, condicoes }) => ({ id, nome, ativo, pontos, condicoes })),
    faixas: faixasSalvas.length > 0 ? faixasSalvas : FAIXAS_SCORE_PADRAO.map((faixa) => ({ ...faixa })),
    faixasConfiguradas: faixasSalvas.length > 0,
    recalculo: progresso
      ? {
          total: progresso.recalculo_total,
          processados: progresso.recalculo_processados,
          emAndamento: progresso.recalculo_iniciado_em !== null && progresso.recalculo_concluido_em === null,
          concluidoEm: progresso.recalculo_concluido_em,
        }
      : null,
  };
}

/**
 * PUT inteiro: regras (ordem = exibição) e faixas. Depois de gravar,
 * recalcula todos os leads (decisão do usuário: na hora, em lotes).
 *
 * @param {string} tenantId
 * @param {{
 *   regras: { nome: string, ativo: boolean, pontos: number, condicoes: { campoId: string, operador: string, valor?: unknown }[] }[],
 *   faixas: { chave?: string, rotulo: string, minimo: number | null, maximo: number | null, cor: string }[],
 * }} input
 */
export async function salvarConfigScore(tenantId, { regras, faixas }) {
  if (regras.length > LIMITES_SCORE.REGRAS_POR_TENANT) {
    throw erroDeValidacao('regras', `Use no máximo ${LIMITES_SCORE.REGRAS_POR_TENANT} regras`);
  }
  const { campos } = await obterSchemaCampos(tenantId);
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));

  const regrasLimpas = regras.map((regra, indice) => normalizarRegra(regra, indice, campoPorId));
  const faixasLimpas = normalizarFaixas(faixas);

  await salvarRegrasEFaixas(tenantId, regrasLimpas, faixasLimpas);
  await garantirScoreVisivel(tenantId);
  await recalcularTodos(tenantId);
  return obterConfigScore(tenantId);
}

/** Onde o score aparece: o formulário de criação fica como está (é só leitura). */
const CONTEXTOS_DO_SCORE = [CONTEXTOS_VISIBILIDADE.FICHA, CONTEXTOS_VISIBILIDADE.TABELA, CONTEXTOS_VISIBILIDADE.FILTRO];

/**
 * O "Lead score" é um campo da Camada 2, que o tenant pode ter desligado.
 * Quem configura a pontuação quer ver o score: liga no detalhe, na tabela e
 * no filtro (o DONO ainda pode esconder depois, em Configurações → Campos).
 *
 * @param {string} tenantId
 */
async function garantirScoreVisivel(tenantId) {
  const campo = (await listarConfiguracaoCampos(tenantId)).find((item) => item.chave === CHAVE_CAMPO_SCORE);
  if (!campo || CONTEXTOS_DO_SCORE.every((contexto) => campo.visibilidade[contexto])) return;
  await atualizarConfiguracaoCampo(tenantId, campo.id, {
    visibilidade: Object.fromEntries(CONTEXTOS_DO_SCORE.map((contexto) => [contexto, true])),
  });
}

/**
 * @param {{ nome: string, ativo: boolean, pontos: number, condicoes: { campoId: string, operador: string, valor?: unknown }[] }} regra
 * @param {number} indice
 * @param {Map<string, CampoDoSchema>} campoPorId
 */
function normalizarRegra({ nome, ativo, pontos, condicoes }, indice, campoPorId) {
  const caminho = `regras.${indice}`;
  const nomeLimpo = nome.trim();
  if (!nomeLimpo) throw erroDeValidacao(`${caminho}.nome`, 'Dê um nome à regra');
  if (condicoes.length > LIMITES_SCORE.CONDICOES_POR_REGRA) {
    throw erroDeValidacao(`${caminho}.condicoes`, `Use no máximo ${LIMITES_SCORE.CONDICOES_POR_REGRA} condições`);
  }
  const condicoesLimpas = condicoes.map((condicao, posicao) => {
    const campo = campoPorId.get(condicao.campoId);
    const caminhoCondicao = `${caminho}.condicoes.${posicao}`;
    if (!campo) throw erroDeValidacao(caminhoCondicao, 'Escolha um campo ativo para a condição');
    if (campo.chave === CHAVE_CAMPO_SCORE) throw erroDeValidacao(caminhoCondicao, 'O score não pode depender dele mesmo');
    try {
      // Mesmas regras de operador × tipo e de formato de valor do filtro.
      condicaoDoCampo(campo, { chave: campo.chave, operador: condicao.operador, valor: condicao.valor });
    } catch (erro) {
      throw erroDeValidacao(caminhoCondicao, erro instanceof Error ? erro.message : 'Condição inválida');
    }
    return OPERADORES_SEM_VALOR.has(condicao.operador)
      ? { campoId: condicao.campoId, operador: condicao.operador }
      : { campoId: condicao.campoId, operador: condicao.operador, valor: condicao.valor };
  });
  return { nome: nomeLimpo, ativo, pontos, condicoes: condicoesLimpas };
}

/**
 * Chave (a dada ou derivada do rótulo) única, e sem sobreposição: em ordem
 * de mínimo, cada faixa começa depois de onde a anterior termina. Buraco
 * entre faixas pode (o lead ali fica sem faixa).
 *
 * @param {{ chave?: string, rotulo: string, minimo: number | null, maximo: number | null, cor: string }[]} faixas
 * @returns {FaixaScoreLinha[]}
 */
export function normalizarFaixas(faixas) {
  if (faixas.length > LIMITES_SCORE.FAIXAS_POR_TENANT) {
    throw erroDeValidacao('faixas', `Use no máximo ${LIMITES_SCORE.FAIXAS_POR_TENANT} faixas`);
  }
  const limpas = faixas.map((faixa, indice) => {
    const rotulo = faixa.rotulo.trim();
    if (!rotulo) throw erroDeValidacao(`faixas.${indice}.rotulo`, 'Dê um nome à faixa');
    if (faixa.minimo !== null && faixa.maximo !== null && faixa.minimo > faixa.maximo) {
      throw erroDeValidacao(`faixas.${indice}`, `"${rotulo}": o mínimo passa do máximo`);
    }
    return { chave: faixa.chave?.trim() || slugify(rotulo) || `faixa_${indice + 1}`, rotulo, minimo: faixa.minimo, maximo: faixa.maximo, cor: faixa.cor };
  });

  const chaves = limpas.map((faixa) => faixa.chave);
  const repetida = chaves.find((chave, indice) => chaves.indexOf(chave) !== indice);
  if (repetida) throw erroDeValidacao('faixas', `Duas faixas com a mesma chave ("${repetida}")`);

  const ordenadas = [...limpas].sort((a, b) => (a.minimo ?? -Infinity) - (b.minimo ?? -Infinity));
  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1];
    const atual = ordenadas[i];
    if (anterior.maximo === null || atual.minimo === null || atual.minimo <= anterior.maximo) {
      throw erroDeValidacao('faixas', `As faixas "${anterior.rotulo}" e "${atual.rotulo}" se sobrepõem`);
    }
  }
  return limpas;
}
