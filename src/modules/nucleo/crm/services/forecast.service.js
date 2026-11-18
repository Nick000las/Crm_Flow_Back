/**
 * @file SERVICE: o forecast (FC2). Realizado (ganhas do mês), ponderado e melhor caso (abertas
 * previstas para o mês, de hoje em diante) e os blocos fora dos meses.
 */
import { createHash } from 'node:crypto';

import { lerComCache } from '#core/cache/cache.js';
import { AppError, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { FUSO_HORARIO_PADRAO } from '#shared/constants/index.js';
import { normalizarFusoHorario } from '#shared/validators/index.js';

import {
  agregarForecast,
  buscarFusoDoTenant,
  buscarMarcaEHoje,
  buscarOportunidadesDoForecast,
} from '../adapters/crm-forecast.repository.js';
import { buscarOportunidade } from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import {
  AGRUPAMENTOS_FORECAST,
  BLOCOS_FORECAST,
  CAMPOS_DO_FORECAST,
  CATEGORIAS_STATUS,
  LIMITES_FORECAST,
  MOTIVOS_IGNORADA_FORECAST,
  ROTULO_SEM_RESPONSAVEL,
  TIPOS_PIPELINE,
} from '../constants.js';
import { editarOportunidade } from './oportunidades.service.js';
import { garantirEscritaPermitida, obterSchemaDoPapel } from './permissoes.service.js';
import { pipelinesOcultos } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: o forecast (FC2). Realizado (ganhas do mês), ponderado e melhor caso
 * (abertas previstas para o mês, de hoje em diante) e os blocos fora dos meses.
 * Os números saem do banco (`crm-forecast.repository.js`); aqui só se valida o
 * pedido, se monta a resposta e se esconde o que o papel não vê.
 *
 * O agregado fica em cache cheio, e a máscara de valor vem depois: papéis que
 * veem coisas diferentes dividem a mesma entrada.
 *
 * @typedef {import('#core/types/module.js').TenantContext} TenantContext
 * @typedef {import('../adapters/crm-forecast.repository.js').LinhaAgregada} LinhaAgregada
 * @typedef {{
 *   mes: string, realizado: { quantidade: number, soma: number | null },
 *   ponderado: { quantidade: number, soma: number | null }, melhorCaso: { soma: number | null },
 *   previsto: number | null, ganhasSemValor: number,
 * }} MesDoForecast
 * @typedef {{ quantidade: number, soma: number | null, ponderado: number | null }} Bloco
 * @typedef {{
 *   atrasadas: Bloco, antesDoPeriodo: Bloco, semPrevisao: Bloco, alemDoHorizonte: Bloco, semValor: { quantidade: number },
 * }} Blocos
 * @typedef {{ chave: string | null, rotulo: string, meses: MesDoForecast[], blocos: Blocos }} Grupo
 * @typedef {{ meses: MesDoForecast[], blocos: Blocos, grupos: Grupo[] }} Agregado
 */

const MESES_NO_ANO = 12;
const DIGITOS_DO_MES = 2;
const TAMANHO_DO_HASH = 16;
const CENTAVOS_POR_REAL = 100n;
const SEM_CENTAVOS = 0n;
const CASAS_DECIMAIS = 2;

const CHAVE_VALOR = 'valor';
const CHAVE_PROBABILIDADE = 'probabilidadeFechamento';
const CHAVE_STATUS = 'status';

/** Bloco do SQL → chave na resposta. */
const BLOCO_NA_RESPOSTA = Object.freeze({
  [BLOCOS_FORECAST.ATRASADAS]: 'atrasadas',
  [BLOCOS_FORECAST.ANTES_DO_PERIODO]: 'antesDoPeriodo',
  [BLOCOS_FORECAST.SEM_PREVISAO]: 'semPrevisao',
  [BLOCOS_FORECAST.ALEM_DO_HORIZONTE]: 'alemDoHorizonte',
  [BLOCOS_FORECAST.SEM_VALOR]: 'semValor',
});

/** Campo que o papel não vê → o que sai de cada item da lista. */
const SAIDAS_DO_ITEM = Object.freeze({
  [CHAVE_VALOR]: Object.freeze(['valor', 'ponderado']),
  [CHAVE_PROBABILIDADE]: Object.freeze(['probabilidadeEfetiva']),
  dataPrevistaFechamento: Object.freeze(['dataPrevistaFechamento']),
  [CHAVE_STATUS]: Object.freeze(['status', 'statusLabel', 'categoria', 'ganhaEm']),
});

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

/**
 * @param {string} mes  `AAAA-MM`
 * @param {number} quantidade  meses para frente (negativo: para trás)
 * @returns {string}
 */
export function deslocarMes(mes, quantidade) {
  const [ano, mesDoAno] = mes.split('-').map(Number);
  const indice = ano * MESES_NO_ANO + (mesDoAno - 1) + quantidade;
  const novoAno = Math.floor(indice / MESES_NO_ANO);
  const novoMes = (indice % MESES_NO_ANO) + 1;

  return `${novoAno}-${String(novoMes).padStart(DIGITOS_DO_MES, '0')}`;
}

/** @param {string} de @param {string} ate @returns {number} meses de um ao outro, inclusive */
export function mesesEntre(de, ate) {
  const indice = (mes) => {
    const [ano, mesDoAno] = mes.split('-').map(Number);

    return ano * MESES_NO_ANO + mesDoAno;
  };

  return indice(ate) - indice(de) + 1;
}

/**
 * O mês atual (de `hoje`) −3 a +3.
 *
 * @param {string} hoje  `AAAA-MM-DD`, no fuso do tenant
 * @returns {{ de: string, ate: string }}
 */
export function periodoPadrao(hoje) {
  const atual = hoje.slice(0, hoje.lastIndexOf('-'));

  return {
    de: deslocarMes(atual, -LIMITES_FORECAST.MESES_ANTES_PADRAO),
    ate: deslocarMes(atual, LIMITES_FORECAST.MESES_DEPOIS_PADRAO),
  };
}

/**
 * O período pedido, com o padrão (mês atual −3 a +3) no que faltar.
 *
 * @param {{ de?: string, ate?: string }} pedido
 * @param {string} hoje  `AAAA-MM-DD`, no fuso do tenant
 * @returns {{ de: string, ate: string }}
 */
export function periodoDoPedido({ de, ate }, hoje) {
  const padrao = periodoPadrao(hoje);
  const periodo = { de: de ?? padrao.de, ate: ate ?? padrao.ate };

  if (periodo.de > periodo.ate) {
    throw erroDeValidacao('de', 'O mês inicial precisa vir antes do final');
  }

  if (mesesEntre(periodo.de, periodo.ate) > LIMITES_FORECAST.MESES_MAXIMOS) {
    throw erroDeValidacao(
      'ate',
      `Escolha um período de até ${LIMITES_FORECAST.MESES_MAXIMOS} meses`,
    );
  }

  return periodo;
}

/**
 * @param {string} de
 * @param {string} ate
 * @returns {string[]} de `de` a `ate`, inclusive
 */
export function mesesDoPeriodo(de, ate) {
  const meses = [];

  for (let mes = de; mes <= ate; mes = deslocarMes(mes, 1)) {
    meses.push(mes);
  }

  return meses;
}

/** @param {string} mes */
export const primeiroDia = (mes) => `${mes}-01`;

/**
 * Decimal em texto (como sai do banco) → centavos inteiros: comparar e somar
 * sem passar por float.
 *
 * @param {string} texto
 * @returns {bigint}
 */
export function centavos(texto) {
  const [inteiro, fracao = ''] = texto.split('.');
  const centavosDaFracao = BigInt(fracao.padEnd(CASAS_DECIMAIS, '0').slice(0, CASAS_DECIMAIS));

  return BigInt(inteiro) * CENTAVOS_POR_REAL + centavosDaFracao;
}

/** @param {string} mes @returns {MesDoForecast} */
const mesVazio = (mes) => ({
  mes,
  realizado: { quantidade: 0, soma: 0 },
  ponderado: { quantidade: 0, soma: 0 },
  melhorCaso: { soma: 0 },
  previsto: 0,
  ganhasSemValor: 0,
});

/** @returns {Blocos} */
const blocosVazios = () => ({
  atrasadas: { quantidade: 0, soma: 0, ponderado: 0 },
  antesDoPeriodo: { quantidade: 0, soma: 0, ponderado: 0 },
  semPrevisao: { quantidade: 0, soma: 0, ponderado: 0 },
  alemDoHorizonte: { quantidade: 0, soma: 0, ponderado: 0 },
  semValor: { quantidade: 0 },
});

/**
 * @param {string[]} meses
 * @returns {{ meses: Map<string, MesDoForecast>, blocos: Blocos, previsto: bigint, quantidade: number }}
 */
const nivelVazio = (meses) => ({
  meses: new Map(meses.map((mes) => [mes, mesVazio(mes)])),
  blocos: blocosVazios(),
  previsto: SEM_CENTAVOS,
  quantidade: 0,
});

/**
 * Uma linha do SQL no nível dela (o total ou um grupo). Mês fora do período não
 * entra; bloco entra pelo nome.
 *
 * @param {ReturnType<typeof nivelVazio>} nivel
 * @param {LinhaAgregada} linha
 */
function preencher(nivel, linha) {
  const doMes = nivel.meses.get(linha.chave);

  if (doMes) {
    doMes.realizado = {
      quantidade: linha.realizado_quantidade,
      soma: Number(linha.realizado_soma),
    };

    doMes.ponderado = { quantidade: linha.aberto_quantidade, soma: Number(linha.aberto_ponderado) };
    doMes.melhorCaso = { soma: Number(linha.aberto_soma) };
    doMes.previsto = Number(linha.previsto);
    doMes.ganhasSemValor = linha.ganhas_sem_valor;
    nivel.previsto += centavos(linha.previsto);
    nivel.quantidade += linha.realizado_quantidade + linha.aberto_quantidade;

    return;
  }

  const bloco = BLOCO_NA_RESPOSTA[linha.chave];

  if (!bloco) {
    return;
  }

  nivel.quantidade += linha.aberto_quantidade;

  nivel.blocos[bloco] =
    bloco === 'semValor'
      ? { quantidade: linha.aberto_quantidade }
      : {
          quantidade: linha.aberto_quantidade,
          soma: Number(linha.aberto_soma),
          ponderado: Number(linha.aberto_ponderado),
        };
}

/**
 * Linhas do SQL → meses (todos do período, mesmo sem dado), blocos e grupos.
 * Os totais do topo vêm das linhas do conjunto inteiro, nunca da soma dos
 * grupos. Grupos: só os com alguma oportunidade, maior previsto primeiro.
 *
 * @param {LinhaAgregada[]} linhas
 * @param {string[]} meses
 * @param {string} agrupar
 * @returns {Agregado}
 */
export function montarAgregado(linhas, meses, agrupar) {
  const total = nivelVazio(meses);
  /** @type {Map<string | null, ReturnType<typeof nivelVazio> & { rotulo: string }>} */
  const grupos = new Map();

  for (const linha of linhas) {
    if (linha.do_total) {
      preencher(total, linha);
      continue;
    }

    let grupo = grupos.get(linha.grupo_chave);

    if (!grupo) {
      const rotulo =
        linha.grupo_chave === null && agrupar === AGRUPAMENTOS_FORECAST.RESPONSAVEL
          ? ROTULO_SEM_RESPONSAVEL
          : (linha.grupo_rotulo ?? linha.grupo_chave ?? '');

      grupo = { ...nivelVazio(meses), rotulo };
      grupos.set(linha.grupo_chave, grupo);
    }

    preencher(grupo, linha);
  }

  const ordenados = [...grupos.entries()]
    .filter(([, grupo]) => grupo.quantidade > 0)
    .sort(([, a], [, b]) => {
      if (a.previsto !== b.previsto) {
        return a.previsto > b.previsto ? -1 : 1;
      }

      return a.rotulo.localeCompare(b.rotulo, 'pt-BR');
    });

  return {
    meses: [...total.meses.values()],
    blocos: total.blocos,
    grupos: ordenados.map(([chave, grupo]) => ({
      chave,
      rotulo: grupo.rotulo,
      meses: [...grupo.meses.values()],
      blocos: grupo.blocos,
    })),
  };
}

/** @param {MesDoForecast[]} meses */
const mesesSemValor = (meses) =>
  meses.map((mes) => ({
    ...mes,
    realizado: { ...mes.realizado, soma: null },
    ponderado: { ...mes.ponderado, soma: null },
    melhorCaso: { soma: null },
    previsto: null,
  }));

/** @param {Blocos} blocos @returns {Blocos} */
const blocosSemValor = (blocos) => ({
  atrasadas: { ...blocos.atrasadas, soma: null, ponderado: null },
  antesDoPeriodo: { ...blocos.antesDoPeriodo, soma: null, ponderado: null },
  semPrevisao: { ...blocos.semPrevisao, soma: null, ponderado: null },
  alemDoHorizonte: { ...blocos.alemDoHorizonte, soma: null, ponderado: null },
  semValor: { ...blocos.semValor },
});

/**
 * Quem não vê Valor: todo número em dinheiro vira `null`. Contagens ficam.
 *
 * @param {Agregado} agregado
 * @returns {Agregado}
 */
export function mascararValores({ meses, blocos, grupos }) {
  return {
    meses: mesesSemValor(meses),
    blocos: blocosSemValor(blocos),
    grupos: grupos.map((grupo) => ({
      ...grupo,
      meses: mesesSemValor(grupo.meses),
      blocos: blocosSemValor(grupo.blocos),
    })),
  };
}

/**
 * @param {{ campos: { chave: string }[] }} schema  o schema do papel
 * @param {string} chave
 */
const ve = ({ campos }, chave) => campos.some((campo) => campo.chave === chave);

/**
 * Campos de que o forecast precisa e o papel não tem (desligados ou ocultos):
 * a tela avisa.
 *
 * @param {{ campos: { chave: string }[] }} schema
 * @returns {string[]}
 */
export function camposDesligados(schema) {
  return CAMPOS_DO_FORECAST.filter((chave) => !ve(schema, chave));
}

/** @param {string | null} valor */
const numero = (valor) => (valor === null ? null : Number(valor));

/**
 * Uma linha da lista no formato da API, sem o que o papel não vê (a chave
 * some, como em `oportunidadeParaOPapel`).
 *
 * @param {Record<string, any>} linha
 * @param {{ campos: { chave: string }[] }} schema
 * @returns {Record<string, unknown>}
 */
export function itemParaOPapel(linha, schema) {
  /** @type {Record<string, unknown>} */
  const item = {
    id: linha.id,
    leadId: linha.lead_id,
    pessoa: linha.pessoa,
    pipelineId: linha.pipeline_id,
    status: linha.status,
    statusLabel: linha.status_label ?? linha.status,
    categoria: linha.status_category,
    valor: numero(linha.valor),
    probabilidadeEfetiva: linha.probabilidade ?? null,
    ponderado: numero(linha.ponderado),
    dataPrevistaFechamento: linha.data_prevista,
    ganhaEm: linha.won_at,
    responsavelId: linha.owner_id,
    atualizadaEm: linha.updated_at,
  };

  for (const [campo, saidas] of Object.entries(SAIDAS_DO_ITEM)) {
    if (ve(schema, campo)) {
      continue;
    }

    for (const saida of saidas) {
      delete item[saida];
    }
  }

  return item;
}

/**
 * @param {string} tenantId
 * @param {string} marca
 * @param {Record<string, unknown>} pedido  tudo que muda o agregado
 */
export function chaveDoCache(tenantId, marca, pedido) {
  const hash = createHash('sha256')
    .update(JSON.stringify(pedido))
    .digest('hex')
    .slice(0, TAMANHO_DO_HASH);

  return `crm:forecast:${tenantId}:${marca}:${hash}`;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

/**
 * Fuso do tenant; vazio ou que o runtime não reconhece cai no padrão.
 *
 * @param {string} tenantId
 */
export async function fusoDoTenant(tenantId) {
  const configurado = await buscarFusoDoTenant(tenantId);

  return (configurado && normalizarFusoHorario(configurado)) || FUSO_HORARIO_PADRAO;
}

/**
 * O escopo comum às duas leituras: fuso, hoje, schema do papel e pipelines
 * ocultos, com os filtros conferidos.
 *
 * @param {TenantContext} context
 * @param {{ pipelineId?: string, responsavelId?: string, agrupar?: string }} filtros
 */
async function prepararEscopo({ tenantId, role }, filtros) {
  const fuso = await fusoDoTenant(tenantId);
  const [{ marca, hoje }, schema, ocultos] = await Promise.all([
    buscarMarcaEHoje(tenantId, fuso),
    obterSchemaDoPapel(tenantId, role),
    pipelinesOcultos(tenantId, role),
  ]);

  // Agrupar por status revela o status: só agrupa quem o vê.
  if (filtros.agrupar === AGRUPAMENTOS_FORECAST.STATUS && !ve(schema, CHAVE_STATUS)) {
    throw erroDeValidacao('agrupar', 'Este campo não está disponível para agrupar');
  }

  if (filtros.pipelineId) {
    const pipeline = (await buscarPipelines(tenantId)).find(
      (item) => item.id === filtros.pipelineId,
    );
    const valido =
      pipeline &&
      pipeline.tipo === TIPOS_PIPELINE.VENDAS &&
      pipeline.ativo &&
      !ocultos.includes(pipeline.id);

    if (!valido) {
      throw erroNaoEncontrado('Pipeline não encontrado');
    }
  }

  return {
    fuso,
    hoje,
    marca,
    schema,
    escopo: {
      tenantId,
      ocultos: [...ocultos].sort(),
      pipelineId: filtros.pipelineId ?? null,
      responsavelId: filtros.responsavelId ?? null,
    },
  };
}

/**
 * GET /crm/forecast.
 *
 * @param {TenantContext} context
 * @param {{ de?: string, ate?: string, pipelineId?: string, responsavelId?: string, agrupar: string }} filtros
 */
export async function consultarForecast(context, filtros) {
  const { fuso, hoje, marca, schema, escopo } = await prepararEscopo(context, filtros);
  const { de, ate } = periodoDoPedido(filtros, hoje);
  const { agrupar } = filtros;

  const chave = chaveDoCache(escopo.tenantId, marca, {
    de,
    ate,
    pipelineId: escopo.pipelineId,
    responsavelId: escopo.responsavelId,
    agrupar,
    ocultos: escopo.ocultos,
    hoje,
    fuso,
  });
  const { vazio, ...agregado } = await lerComCache(
    chave,
    LIMITES_FORECAST.TTL_CACHE_SEGUNDOS,
    async () => {
      const { linhas, vazio: semOportunidades } = await agregarForecast({
        ...escopo,
        fuso,
        hoje,
        de: primeiroDia(de),
        ate: primeiroDia(ate),
        agrupar,
      });

      return {
        vazio: semOportunidades,
        ...montarAgregado(linhas, mesesDoPeriodo(de, ate), agrupar),
      };
    },
  );

  const veValor = ve(schema, CHAVE_VALOR);

  return {
    fuso,
    hoje,
    periodo: { de, ate },
    filtros: { pipelineId: escopo.pipelineId, responsavelId: escopo.responsavelId, agrupar },
    veValor,
    // O ponderado agregado continua para quem não vê a probabilidade (decisão do dono).
    veProbabilidade: ve(schema, CHAVE_PROBABILIDADE),
    camposDesligados: camposDesligados(schema),
    vazio,
    ...(veValor ? agregado : mascararValores(agregado)),
  };
}

/**
 * GET /crm/forecast/oportunidades: as oportunidades de um mês (ganhas ou
 * abertas) ou de um bloco. Sem cache.
 *
 * @param {TenantContext} context
 * @param {{
 *   mes?: string, tipo?: string, bloco?: string, de?: string, ate?: string,
 *   pipelineId?: string, responsavelId?: string, pagina: number, tamanho: number,
 * }} pedido
 */
export async function listarOportunidadesDoForecast(context, pedido) {
  const { fuso, hoje, schema, escopo } = await prepararEscopo(context, pedido);
  const { pagina, tamanho } = pedido;
  const selecao = pedido.mes
    ? { mes: primeiroDia(pedido.mes), tipo: /** @type {string} */ (pedido.tipo) }
    : {
        bloco: /** @type {string} */ (pedido.bloco),
        de: primeiroDia(pedido.de ?? periodoPadrao(hoje).de),
        ate: primeiroDia(pedido.ate ?? periodoPadrao(hoje).ate),
      };

  const { linhas, total } = await buscarOportunidadesDoForecast({
    ...escopo,
    fuso,
    hoje,
    selecao,
    limite: tamanho,
    offset: (pagina - 1) * tamanho,
  });

  return { itens: linhas.map((linha) => itemParaOPapel(linha, schema)), total, pagina, tamanho };
}

/**
 * POST /crm/forecast/data-prevista: a mesma data em várias oportunidades
 * abertas, uma por vez, pela porta de sempre (histórico e outbox de cada uma).
 * Sem `expectedUpdatedAt`: a última escrita vence. Quem não pode escrever o
 * campo recebe 403 antes de gravar qualquer uma.
 *
 * @param {TenantContext} context
 * @param {{ oportunidadeIds: string[], dataPrevistaFechamento: Date }} dados
 * @returns {Promise<{ atualizadas: number, ignoradas: { id: string, motivo: string }[] }>}
 */
export async function definirDataPrevistaEmLote({ tenantId, userId, role }, dados) {
  const { oportunidadeIds, dataPrevistaFechamento } = dados;
  const [schema, ocultos] = await Promise.all([
    obterSchemaDoPapel(tenantId, role),
    pipelinesOcultos(tenantId, role),
  ]);

  garantirEscritaPermitida(schema, { dataPrevistaFechamento });

  let atualizadas = 0;
  const ignoradas = [];

  for (const id of oportunidadeIds) {
    const deal = await buscarOportunidade(tenantId, id);

    if (!deal || ocultos.includes(deal.pipeline_id)) {
      ignoradas.push({ id, motivo: MOTIVOS_IGNORADA_FORECAST.NAO_ENCONTRADA });
      continue;
    }

    if (deal.status_category !== CATEGORIAS_STATUS.ABERTO) {
      ignoradas.push({ id, motivo: MOTIVOS_IGNORADA_FORECAST.NAO_ABERTA });
      continue;
    }

    try {
      await editarOportunidade(tenantId, id, { dataPrevistaFechamento }, userId, { papel: role });
      atualizadas += 1;
    } catch (erro) {
      if (!(erro instanceof AppError)) {
        throw erro;
      }

      ignoradas.push({ id, motivo: erro.code });
    }
  }

  return { atualizadas, ignoradas };
}
