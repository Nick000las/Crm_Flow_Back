import { erroDeValidacao } from '#core/errors/app-error.js';
import { agregarForecast } from '../adapters/crm-forecast.repository.js';
import { buscarSnapshotsDoPeriodo } from '../adapters/crm-forecast-snapshot.repository.js';
import { buscarNomesDeUsuarios } from '../adapters/usuarios.repository.js';
import {
  AGRUPAMENTOS_FORECAST,
  LIMITES_ASSERTIVIDADE,
  LIMITES_FORECAST,
  ROTULO_RESPONSAVEL_REMOVIDO,
  ROTULO_SEM_RESPONSAVEL,
  SNAPSHOT_FORECAST,
} from '../constants.js';
import {
  centavos,
  deslocarMes,
  fusoDoTenant,
  mesesDoPeriodo,
  mesesEntre,
  primeiroDia,
} from './forecast.service.js';
import { dataEHoraLocal } from './inatividade.service.js';

/**
 * SERVICE: a assertividade do forecast (FC3). Para cada mês fechado, o que o
 * primeiro snapshot tirado dentro dele previa (realizado até ali + ponderado)
 * contra o que de fato se ganhou. Só a gestão lê (DONO e MASTER veem tudo):
 * não há máscara de valor. Sem cache.
 *
 * Dinheiro é somado em centavos inteiros (`bigint`); só a resposta vira
 * `Number`.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {import('../adapters/crm-forecast.repository.js').LinhaAgregada} LinhaAgregada
 * @typedef {import('../adapters/crm-forecast-snapshot.repository.js').SnapshotGravado} SnapshotGravado
 * @typedef {{ total: bigint, porDono: Map<string, bigint> }} RealizadoDoMes
 *   `porDono`: chave do `by_owner` (id ou `sem_responsavel`)
 * @typedef {{
 *   responsavelId: string | null, rotulo: string, previsto: number, realizado: number,
 *   assertividade: number | null,
 * }} Responsavel
 */

const TAMANHO_DO_MES = 7;
const SEM_CENTAVOS = 0n;
const CENTAVOS_POR_REAL = 100;
const DOBRO = 2n;
const BASE_DECIMAL = 10n;
const ESCALA_DA_RAZAO = BASE_DECIMAL ** BigInt(LIMITES_ASSERTIVIDADE.CASAS_DA_ASSERTIVIDADE);

const SEM_RESPONSAVEL = SNAPSHOT_FORECAST.CHAVE_SEM_RESPONSAVEL;

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

/**
 * O período pedido, só de meses fechados. Padrão: os seis meses antes do
 * atual (no fuso do tenant).
 *
 * @param {{ de?: string, ate?: string }} pedido
 * @param {string} hoje  `AAAA-MM-DD`, no fuso do tenant
 * @returns {{ de: string, ate: string }}
 */
export function periodoDaAssertividade({ de, ate }, hoje) {
  const atual = hoje.slice(0, TAMANHO_DO_MES);
  const fim = ate ?? deslocarMes(atual, -1);
  const periodo = { de: de ?? deslocarMes(fim, 1 - LIMITES_ASSERTIVIDADE.MESES_PADRAO), ate: fim };
  if (periodo.de > periodo.ate) {
    throw erroDeValidacao('de', 'O mês inicial precisa vir antes do final');
  }
  if (mesesEntre(periodo.de, periodo.ate) > LIMITES_FORECAST.MESES_MAXIMOS) {
    throw erroDeValidacao(
      'ate',
      `Escolha um período de até ${LIMITES_FORECAST.MESES_MAXIMOS} meses`,
    );
  }
  if (periodo.ate >= atual) {
    throw erroDeValidacao('ate', 'Só meses fechados: escolha um mês anterior ao atual');
  }
  return periodo;
}

/**
 * O snapshot que vale para cada mês: o de menor `tirado_em` entre os de uma
 * semana que começou dentro do próprio mês.
 *
 * @param {SnapshotGravado[]} snapshots
 * @returns {Map<string, SnapshotGravado>}
 */
export function snapshotsPorMes(snapshots) {
  /** @type {Map<string, SnapshotGravado>} */
  const escolhidos = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.semana.slice(0, TAMANHO_DO_MES) !== snapshot.mes) continue;
    const atual = escolhidos.get(snapshot.mes);
    if (!atual || snapshot.tirado_em.getTime() < atual.tirado_em.getTime()) {
      escolhidos.set(snapshot.mes, snapshot);
    }
  }
  return escolhidos;
}

/**
 * O realizado de agora de cada mês (ganhas pelo mês local), no total e por
 * responsável com alguma ganha no mês.
 *
 * @param {LinhaAgregada[]} linhas  agregado por responsável
 * @returns {Map<string, RealizadoDoMes>}
 */
export function realizadosPorMes(linhas) {
  /** @type {Map<string, RealizadoDoMes>} */
  const meses = new Map();
  const doMes = (mes) => {
    let realizado = meses.get(mes);
    if (!realizado) {
      realizado = { total: SEM_CENTAVOS, porDono: new Map() };
      meses.set(mes, realizado);
    }
    return realizado;
  };
  for (const linha of linhas) {
    if (linha.realizado_quantidade === 0) continue;
    const realizado = doMes(linha.chave);
    if (linha.do_total) realizado.total = centavos(linha.realizado_soma);
    else
      realizado.porDono.set(linha.grupo_chave ?? SEM_RESPONSAVEL, centavos(linha.realizado_soma));
  }
  return meses;
}

/**
 * `realizado / previsto` com quatro casas, arredondada (meio para cima), em
 * inteiros até o fim. Previsto zero: `null`.
 *
 * @param {bigint} realizado  centavos
 * @param {bigint} previsto  centavos
 * @returns {number | null}
 */
export function razao(realizado, previsto) {
  if (previsto === SEM_CENTAVOS) return null;
  const escalada = (realizado * ESCALA_DA_RAZAO * DOBRO + previsto) / (DOBRO * previsto);
  return Number(escalada) / Number(ESCALA_DA_RAZAO);
}

/** @param {bigint} valor  centavos */
const reais = (valor) => Number(valor) / CENTAVOS_POR_REAL;

/**
 * Os responsáveis de um mês com snapshot: os do `by_owner` e os com realizado
 * no mês. Maior previsto primeiro, depois o rótulo.
 *
 * @param {SnapshotGravado} snapshot
 * @param {Map<string, bigint>} realizadoPorDono
 * @param {Map<string, string>} nomes  id → nome, dos que ainda existem
 * @returns {Responsavel[]}
 */
export function montarPorResponsavel(snapshot, realizadoPorDono, nomes) {
  const chaves = new Set([...Object.keys(snapshot.by_owner), ...realizadoPorDono.keys()]);
  const linhas = [...chaves].map((chave) => {
    const doSnapshot = snapshot.by_owner[chave];
    const previsto = doSnapshot
      ? centavos(doSnapshot.realized) + centavos(doSnapshot.weighted)
      : SEM_CENTAVOS;
    const realizado = realizadoPorDono.get(chave) ?? SEM_CENTAVOS;
    const semDono = chave === SEM_RESPONSAVEL;
    /** @type {Responsavel} */
    const responsavel = {
      responsavelId: semDono ? null : chave,
      rotulo: semDono ? ROTULO_SEM_RESPONSAVEL : (nomes.get(chave) ?? ROTULO_RESPONSAVEL_REMOVIDO),
      previsto: reais(previsto),
      realizado: reais(realizado),
      assertividade: razao(realizado, previsto),
    };
    return { previsto, responsavel };
  });
  linhas.sort((a, b) => {
    if (a.previsto !== b.previsto) return a.previsto > b.previsto ? -1 : 1;
    return a.responsavel.rotulo.localeCompare(b.responsavel.rotulo, 'pt-BR');
  });
  return linhas.map((linha) => linha.responsavel);
}

/**
 * Um mês da resposta. Sem snapshot (`semDados`), só o realizado aparece.
 *
 * @param {string} mes  `AAAA-MM`
 * @param {SnapshotGravado | undefined} snapshot
 * @param {RealizadoDoMes | undefined} realizadoDoMes
 * @param {Map<string, string>} nomes
 */
export function montarMesDaAssertividade(mes, snapshot, realizadoDoMes, nomes) {
  const realizado = realizadoDoMes?.total ?? SEM_CENTAVOS;
  if (!snapshot) {
    return {
      mes,
      semDados: true,
      snapshot: null,
      previsto: null,
      realizadoNoSnapshot: null,
      ponderadoNoSnapshot: null,
      realizado: reais(realizado),
      assertividade: null,
      porResponsavel: [],
    };
  }
  const realizadoNoSnapshot = centavos(snapshot.realized);
  const ponderadoNoSnapshot = centavos(snapshot.weighted);
  const previsto = realizadoNoSnapshot + ponderadoNoSnapshot;
  return {
    mes,
    semDados: false,
    snapshot: { semana: snapshot.semana, tiradoEm: snapshot.tirado_em },
    previsto: reais(previsto),
    realizadoNoSnapshot: reais(realizadoNoSnapshot),
    ponderadoNoSnapshot: reais(ponderadoNoSnapshot),
    realizado: reais(realizado),
    assertividade: razao(realizado, previsto),
    porResponsavel: montarPorResponsavel(snapshot, realizadoDoMes?.porDono ?? new Map(), nomes),
  };
}

/**
 * Ids de responsável (sem o `sem_responsavel`) de que a resposta precisa do nome.
 *
 * @param {Map<string, SnapshotGravado>} snapshots
 * @param {Map<string, RealizadoDoMes>} realizados
 * @returns {string[]}
 */
function idsDosResponsaveis(snapshots, realizados) {
  const ids = new Set();
  for (const snapshot of snapshots.values()) {
    for (const chave of Object.keys(snapshot.by_owner)) ids.add(chave);
  }
  for (const realizado of realizados.values()) {
    for (const chave of realizado.porDono.keys()) ids.add(chave);
  }
  ids.delete(SEM_RESPONSAVEL);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Rota
// ---------------------------------------------------------------------------

/**
 * GET /crm/forecast/assertividade. Mês mais recente primeiro; todo mês do
 * período aparece, com ou sem snapshot.
 *
 * @param {TenantContext} context
 * @param {{ de?: string, ate?: string }} pedido
 * @param {Date} [agora]
 */
export async function consultarAssertividade({ tenantId }, pedido, agora = new Date()) {
  const fuso = await fusoDoTenant(tenantId);
  const { data: hoje } = dataEHoraLocal(agora, fuso);
  const { de, ate } = periodoDaAssertividade(pedido, hoje);

  // O realizado de agora com o escopo do snapshot: todos os pipelines de
  // vendas ativos, sem ocultos e sem filtro de responsável.
  const [gravados, { linhas }] = await Promise.all([
    buscarSnapshotsDoPeriodo(tenantId, primeiroDia(de), primeiroDia(ate)),
    agregarForecast({
      tenantId,
      ocultos: [],
      pipelineId: null,
      responsavelId: null,
      fuso,
      hoje,
      de: primeiroDia(de),
      ate: primeiroDia(ate),
      agrupar: AGRUPAMENTOS_FORECAST.RESPONSAVEL,
    }),
  ]);
  const snapshots = snapshotsPorMes(gravados);
  const realizados = realizadosPorMes(linhas);
  const nomes = await buscarNomesDeUsuarios(tenantId, idsDosResponsaveis(snapshots, realizados));

  return {
    fuso,
    periodo: { de, ate },
    meses: mesesDoPeriodo(de, ate)
      .reverse()
      .map((mes) => montarMesDaAssertividade(mes, snapshots.get(mes), realizados.get(mes), nomes)),
  };
}
