/**
 * @file SERVICE: o snapshot semanal do forecast (FC3).
 */
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { listarTenantsAtivosDoModulo } from '#core/tenant/module-access.js';

import { agregarForecast } from '../adapters/crm-forecast.repository.js';
import {
  existeSnapshotDaSemana,
  gravarSnapshot,
} from '../adapters/crm-forecast-snapshot.repository.js';
import { agendarSnapshotSemanal } from '../adapters/manutencao-queue.adapter.js';
import {
  AGRUPAMENTOS_FORECAST,
  CRM_FEATURES,
  MODULO_CRM,
  RESULTADOS_SNAPSHOT,
  SNAPSHOT_FORECAST,
} from '../constants.js';
import {
  centavos,
  deslocarMes,
  fusoDoTenant,
  mesesDoPeriodo,
  primeiroDia,
} from './forecast.service.js';
import { dataEHoraLocal } from './inatividade.service.js';

/**
 * SERVICE: o snapshot semanal do forecast (FC3). Toda semana, a partir de
 * segunda às 6h no fuso do tenant, grava o forecast do mês atual e dos três
 * seguintes como estava naquele momento: a base da assertividade. O escopo é
 * o do forecast sem restrição de papel (todos os pipelines de vendas ativos,
 * sem filtro de responsável).
 *
 * @typedef {import('../adapters/crm-forecast.repository.js').LinhaAgregada} LinhaAgregada
 * @typedef {import('../adapters/crm-forecast-snapshot.repository.js').LinhaNova} LinhaNova
 * @typedef {import('../adapters/crm-forecast-snapshot.repository.js').NumerosDoSnapshot} NumerosDoSnapshot
 */

const DIAS_NA_SEMANA = 7;
const DOMINGO = 0;
const TAMANHO_DA_DATA = 10;
const TAMANHO_DO_MES = 7;
const CENTAVOS_POR_REAL = 100n;
const SEM_CENTAVOS = 0n;
const CASAS_DECIMAIS = 2;

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

/**
 * @param {string} data  `AAAA-MM-DD`
 * @returns {string} a segunda-feira da semana (ISO: de segunda a domingo)
 */
export function segundaDaSemana(data) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));
  const diaDaSemana = dataUtc.getUTCDay();
  const desdeSegunda = diaDaSemana === DOMINGO ? DIAS_NA_SEMANA - 1 : diaDaSemana - 1;

  dataUtc.setUTCDate(dataUtc.getUTCDate() - desdeSegunda);

  return dataUtc.toISOString().slice(0, TAMANHO_DA_DATA);
}

/**
 * A semana do snapshot para um instante no fuso do tenant. Na segunda antes
 * das 6h locais, a semana ainda não começou (`cedo`): não se grava a anterior
 * de novo.
 *
 * @param {Date} agora
 * @param {string} fuso
 * @returns {{ hoje: string, semana: string, cedo: boolean }}
 */
export function momentoDoSnapshot(agora, fuso) {
  const { data, hora } = dataEHoraLocal(agora, fuso);
  const semana = segundaDaSemana(data);

  return { hoje: data, semana, cedo: data === semana && hora < SNAPSHOT_FORECAST.HORA_LOCAL };
}

/**
 * Centavos → texto decimal com duas casas (`"1234.50"`), como vai para o banco
 * e para o `by_owner`.
 *
 * @param {bigint} valor
 * @returns {string}
 */
export function textoDeCentavos(valor) {
  const sinal = valor < SEM_CENTAVOS ? '-' : '';
  const absoluto = valor < SEM_CENTAVOS ? -valor : valor;
  const fracao = String(absoluto % CENTAVOS_POR_REAL).padStart(CASAS_DECIMAIS, '0');

  return `${sinal}${absoluto / CENTAVOS_POR_REAL}.${fracao}`;
}

/** @param {string} texto  decimal do banco */
const normalizado = (texto) => textoDeCentavos(centavos(texto));

/** @param {LinhaAgregada} linha @returns {NumerosDoSnapshot} */
const numerosDaLinha = (linha) => ({
  realized: normalizado(linha.realizado_soma),
  weighted: normalizado(linha.aberto_ponderado),
  best_case: normalizado(linha.aberto_soma),
  won_count: linha.realizado_quantidade,
  open_count: linha.aberto_quantidade,
});

/** @type {NumerosDoSnapshot} */
const NUMEROS_ZERADOS = Object.freeze({
  realized: textoDeCentavos(SEM_CENTAVOS),
  weighted: textoDeCentavos(SEM_CENTAVOS),
  best_case: textoDeCentavos(SEM_CENTAVOS),
  won_count: 0,
  open_count: 0,
});

/**
 * Linhas do agregado (agrupado por responsável) → uma linha por mês pedido.
 * Mês sem oportunidade grava zeros: a linha existe ("previa zero"). Blocos
 * (atrasadas, sem previsão...) não entram.
 *
 * @param {LinhaAgregada[]} linhas
 * @param {string[]} meses  `AAAA-MM`
 * @returns {LinhaNova[]}
 */
export function linhasDoSnapshot(linhas, meses) {
  return meses.map((mes) => {
    const doMes = linhas.filter((linha) => linha.chave === mes);
    const total = doMes.find((linha) => linha.do_total);
    /** @type {Record<string, NumerosDoSnapshot>} */
    const porDono = {};

    for (const linha of doMes) {
      if (linha.do_total) {
        continue;
      }

      porDono[linha.grupo_chave ?? SNAPSHOT_FORECAST.CHAVE_SEM_RESPONSAVEL] = numerosDaLinha(linha);
    }

    return {
      mes: primeiroDia(mes),
      ...(total ? numerosDaLinha(total) : NUMEROS_ZERADOS),
      by_owner: porDono,
    };
  });
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/**
 * Um tenant do job: sem a flag, cedo demais ou com a semana já gravada, não
 * grava nada.
 *
 * @param {string} tenantId
 * @param {Date} agora
 * @returns {Promise<string>} um de `RESULTADOS_SNAPSHOT`
 */
export async function tirarSnapshotDoTenant(tenantId, agora) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.FORECAST))) {
    return RESULTADOS_SNAPSHOT.SEM_FLAG;
  }

  const fuso = await fusoDoTenant(tenantId);
  const { hoje, semana, cedo } = momentoDoSnapshot(agora, fuso);

  if (cedo) {
    return RESULTADOS_SNAPSHOT.CEDO;
  }

  if (await existeSnapshotDaSemana(tenantId, semana)) {
    return RESULTADOS_SNAPSHOT.JA_EXISTIA;
  }

  const atual = hoje.slice(0, TAMANHO_DO_MES);
  const ultimo = deslocarMes(atual, SNAPSHOT_FORECAST.MESES_A_FRENTE);
  const { linhas } = await agregarForecast({
    tenantId,
    ocultos: [],
    pipelineId: null,
    responsavelId: null,
    fuso,
    hoje,
    de: primeiroDia(atual),
    ate: primeiroDia(ultimo),
    agrupar: AGRUPAMENTOS_FORECAST.RESPONSAVEL,
  });
  const gravadas = await gravarSnapshot(
    tenantId,
    semana,
    agora,
    linhasDoSnapshot(linhas, mesesDoPeriodo(atual, ultimo)),
  );

  return gravadas > 0 ? RESULTADOS_SNAPSHOT.GRAVADO : RESULTADOS_SNAPSHOT.JA_EXISTIA;
}

/**
 * Job de hora em hora (`crm-manutencao`): em cada tenant com o CRM ativo, o
 * snapshot da semana, se ainda não houver. Falha num tenant entra no
 * relatório e não para os outros.
 *
 * @param {Date} [agora]
 * @returns {Promise<{ tenants: number, gravados: number, pulados: number, falhas: { tenantId: string, erro: string }[] }>}
 */
export async function executarSnapshotsDoForecast(agora = new Date()) {
  const tenants = await listarTenantsAtivosDoModulo(MODULO_CRM);
  const relatorio = { tenants: tenants.length, gravados: 0, pulados: 0, falhas: [] };

  for (const { tenantId } of tenants) {
    try {
      const resultado = await tirarSnapshotDoTenant(tenantId, agora);

      if (resultado === RESULTADOS_SNAPSHOT.GRAVADO) {
        relatorio.gravados += 1;
      } else {
        relatorio.pulados += 1;
      }
    } catch (erro) {
      relatorio.falhas.push({
        tenantId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return relatorio;
}

/**
 * Chamado pelo worker ao subir: garante o agendamento de hora em hora.
 *
 * @param {string} redisUrl
 */
export function agendarSnapshotsDoForecast(redisUrl) {
  return agendarSnapshotSemanal(redisUrl);
}
