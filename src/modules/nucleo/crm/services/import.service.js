import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { buscarEstagiosPorTenant } from '../adapters/funil-estagios.repository.js';
import {
  criarImportJob,
  buscarImportJob,
  buscarImportJobComPayload,
  transicionarStatus,
  registrarProgresso,
  marcarFalha,
} from '../adapters/import-jobs.repository.js';
import { enfileirarImportacao, encerrarFilaImportacao } from '../adapters/import-queue.repository.js';
import { buscarLeadDuplicado, criarLead, atualizarLead } from '../adapters/leads.repository.js';
import {
  CAMADA,
  CAMADA_2_COLUNA_PARA_CAMPO,
  CAMADA_2_METADADOS,
  CAMPOS_CAMADA_1,
  CAMPOS_EXTRAS_PLANILHA,
  IMPORT_JOB_STATUS,
  IMPORTACAO,
} from '../constants.js';
import { listarCamposDoTenant } from './leads.service.js';
import { lerPlanilha } from './planilha.service.js';

/**
 * SERVICE: importação de leads por planilha
 * (docs/plano-crm-campos-filtros-import-export.md §3.3). Fluxo:
 * preview (não grava) → validate (valida tudo, grava job `pendente` com as
 * linhas válidas) → confirm (enfileira) → worker chama `processarImportacao`.
 * Nada é gravado em `leads` dentro de um request HTTP.
 *
 * @typedef {import('./planilha.service.js').LinhaPlanilha} LinhaPlanilha
 * @typedef {import('./planilha.service.js').ValorCelula} ValorCelula
 * @typedef {{ chave: string, label: string, tipo: string, camada?: number, obrigatorio: boolean, opcoes?: readonly string[] | null }} CampoPlanilha
 * @typedef {{ linha: number, coluna?: string, motivo: string }} ErroDeLinha
 */

const CHAVE_ESTAGIO = 'funilEstagio';
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PADRAO_DATA_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const VALORES_VERDADEIROS = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes']);
const VALORES_FALSOS = new Set(['não', 'nao', 'n', 'false', 'falso', '0', 'no']);

/**
 * Campos nativos (Camadas 1/2) do tipo data — no payload JSONB viram
 * string ISO e precisam voltar a `Date` antes do INSERT (o Prisma não
 * converte string pra TIMESTAMP num parâmetro de `$queryRaw`).
 */
const CHAVES_DATA_NATIVAS = Object.freeze([
  ...CAMPOS_CAMADA_1.filter((campo) => campo.tipo === 'data').map((campo) => campo.chave),
  ...Object.entries(CAMADA_2_METADADOS)
    .filter(([, metadado]) => metadado.tipo === 'data')
    .map(([coluna]) => CAMADA_2_COLUNA_PARA_CAMPO[coluna]),
]);

/**
 * Lê a planilha e devolve cabeçalho + primeiras linhas + campos que
 * podem receber mapeamento — tudo que a tela de mapeamento precisa.
 *
 * @param {string} tenantId
 * @param {Buffer} buffer
 */
export async function previsualizarImportacao(tenantId, buffer) {
  const [{ colunas, linhas }, campos] = await Promise.all([
    lerPlanilha(buffer),
    listarCamposDaPlanilha(tenantId),
  ]);

  return {
    colunas,
    totalLinhas: linhas.length,
    linhas: linhas.slice(0, IMPORTACAO.LINHAS_PREVIEW).map((linha) => linha.valores),
    campos,
  };
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {Buffer} buffer
 * @param {{ mapeamento: Record<string, string>, estrategiaDuplicata: string }} opcoes
 *   `mapeamento` é `{ colunaDaPlanilha: chaveDoCampo }`.
 * @returns {Promise<{ jobId: string | null, totalLinhas: number, linhasValidas: number, erros: ErroDeLinha[] }>}
 */
export async function validarImportacao(tenantId, usuarioId, buffer, { mapeamento, estrategiaDuplicata }) {
  const [{ colunas, linhas }, campos, estagios] = await Promise.all([
    lerPlanilha(buffer),
    listarCamposDaPlanilha(tenantId),
    buscarEstagiosPorTenant(tenantId),
  ]);

  const campoPorChave = new Map(campos.map((campo) => [campo.chave, campo]));
  validarMapeamento(mapeamento, colunas, campos, campoPorChave);

  const estagioPorNome = new Map(estagios.map((estagio) => [estagio.nome.trim().toLowerCase(), estagio.id]));

  /** @type {ErroDeLinha[]} */
  const erros = [];
  const payload = [];
  for (const linha of linhas) {
    const resultado = converterLinha(linha, mapeamento, campos, campoPorChave, estagioPorNome);
    if (resultado.erros.length > 0) {
      erros.push(...resultado.erros);
    } else {
      payload.push({ linha: linha.numero, dados: resultado.dados });
    }
  }

  if (payload.length === 0) {
    return { jobId: null, totalLinhas: linhas.length, linhasValidas: 0, erros };
  }

  const { id: jobId } = await criarImportJob(tenantId, { usuarioId, estrategiaDuplicata, payload });
  return { jobId, totalLinhas: linhas.length, linhasValidas: payload.length, erros };
}

/**
 * @param {string} tenantId
 * @param {string} jobId
 */
export async function confirmarImportacao(tenantId, jobId) {
  const transicionou = await transicionarStatus(
    tenantId,
    jobId,
    IMPORT_JOB_STATUS.PENDENTE,
    IMPORT_JOB_STATUS.PROCESSANDO,
  );

  if (!transicionou) {
    await obterStatusImportacao(tenantId, jobId); // 404 se não existir
    throw new AppError({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Esta importação já foi confirmada',
    });
  }

  try {
    await enfileirarImportacao(tenantId, jobId);
  } catch (erro) {
    // Volta pra `pendente` pra o usuário poder confirmar de novo depois.
    await transicionarStatus(tenantId, jobId, IMPORT_JOB_STATUS.PROCESSANDO, IMPORT_JOB_STATUS.PENDENTE);
    throw new AppError({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.QUEUE_UNAVAILABLE,
      message: 'A fila de importação está indisponível no momento. Tente confirmar novamente em instantes.',
      cause: erro,
    });
  }

  return obterStatusImportacao(tenantId, jobId);
}

/**
 * @param {string} tenantId
 * @param {string} jobId
 */
export async function obterStatusImportacao(tenantId, jobId) {
  const job = await buscarImportJob(tenantId, jobId);

  if (!job) {
    throw new AppError({
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: 'Importação não encontrada',
    });
  }

  return job;
}

/**
 * Chamado pelo worker (`src/workers/crm-import.worker.js`), nunca por
 * HTTP. Erro numa linha vai pro relatório sem derrubar o job; erro geral
 * (banco fora, etc.) marca `falhou`.
 *
 * @param {string} tenantId
 * @param {string} jobId
 */
export async function processarImportacao(tenantId, jobId) {
  const job = await buscarImportJobComPayload(tenantId, jobId);
  if (!job || job.status !== IMPORT_JOB_STATUS.PROCESSANDO) return;

  const progresso = {
    linhasProcessadas: 0,
    linhasCriadas: 0,
    linhasAtualizadas: 0,
    linhasIgnoradas: 0,
    linhasComErro: 0,
    relatorioErro: [],
  };

  try {
    const [estagioPadrao] = await buscarEstagiosPorTenant(tenantId);

    for (const item of job.payload) {
      try {
        const resultado = await importarLinha(
          tenantId,
          reviverDatas(item.dados),
          job.estrategia_duplicata,
          { estagioPadraoId: estagioPadrao?.id ?? null, responsavelPadraoId: job.usuario_id },
        );
        progresso[resultado] += 1;
      } catch (erro) {
        progresso.linhasComErro += 1;
        progresso.relatorioErro.push({ linha: item.linha, motivo: motivoDoErro(erro) });
      }

      progresso.linhasProcessadas += 1;
      if (progresso.linhasProcessadas % IMPORTACAO.LOTE_PROGRESSO === 0) {
        await registrarProgresso(tenantId, jobId, progresso);
      }
    }

    await registrarProgresso(tenantId, jobId, { ...progresso, statusFinal: IMPORT_JOB_STATUS.CONCLUIDO });
  } catch (erro) {
    await marcarFalha(tenantId, jobId);
    throw erro;
  }
}

/** Fecha a conexão do produtor da fila (shutdown do servidor HTTP). */
export function encerrarImportacao() {
  return encerrarFilaImportacao();
}

/**
 * @param {string} tenantId
 * @param {Record<string, unknown>} dados
 * @param {string} estrategia `pular` | `atualizar` | `criar`
 * @param {{ estagioPadraoId: string | null, responsavelPadraoId: string }} padroes
 *   aplicados só em lead novo — quem importou vira o responsável
 * @returns {Promise<'linhasCriadas' | 'linhasAtualizadas' | 'linhasIgnoradas'>}
 */
async function importarLinha(tenantId, dados, estrategia, { estagioPadraoId, responsavelPadraoId }) {
  if (estrategia !== 'criar') {
    const existente = await buscarLeadDuplicado(tenantId, {
      email: /** @type {string | undefined} */ (dados.email),
      telefoneDigitos: dados.telefone ? somenteDigitos(String(dados.telefone)) : null,
    });

    if (existente) {
      if (estrategia === 'pular') return 'linhasIgnoradas';
      // Sem estágio padrão aqui de propósito: atualizar não pode mover o
      // lead de estágio só porque a planilha não tinha a coluna.
      await atualizarLead(tenantId, existente.id, dados);
      return 'linhasAtualizadas';
    }
  }

  await criarLead(tenantId, {
    ...dados,
    funilEstagioId: dados.funilEstagioId ?? estagioPadraoId,
    usuarioResponsavelId: responsavelPadraoId,
  });
  return 'linhasCriadas';
}

/**
 * Campos que aceitam mapeamento: os ativos do tenant + extras de planilha
 * (`valor`, estágio pelo nome).
 *
 * @param {string} tenantId
 * @returns {Promise<CampoPlanilha[]>}
 */
async function listarCamposDaPlanilha(tenantId) {
  const campos = await listarCamposDoTenant(tenantId);
  return [...campos, ...CAMPOS_EXTRAS_PLANILHA];
}

/**
 * @param {Record<string, string>} mapeamento
 * @param {string[]} colunas
 * @param {CampoPlanilha[]} campos
 * @param {Map<string, CampoPlanilha>} campoPorChave
 */
function validarMapeamento(mapeamento, colunas, campos, campoPorChave) {
  const problemas = [];
  const chavesMapeadas = Object.values(mapeamento);

  for (const [coluna, chave] of Object.entries(mapeamento)) {
    if (!colunas.includes(coluna)) problemas.push(`A coluna "${coluna}" não existe na planilha`);
    if (!campoPorChave.has(chave)) problemas.push(`"${chave}" não é um campo ativo`);
  }

  const repetida = chavesMapeadas.find((chave, i) => chavesMapeadas.indexOf(chave) !== i);
  if (repetida) problemas.push(`O campo "${campoPorChave.get(repetida)?.label ?? repetida}" foi mapeado mais de uma vez`);

  for (const campo of campos) {
    if (campo.obrigatorio && !chavesMapeadas.includes(campo.chave)) {
      problemas.push(`O campo obrigatório "${campo.label}" não foi mapeado`);
    }
  }
  if (!chavesMapeadas.includes('email') && !chavesMapeadas.includes('telefone')) {
    problemas.push('Mapeie ao menos a coluna de e-mail ou a de telefone');
  }

  if (problemas.length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Revise o mapeamento das colunas',
      fields: { mapeamento: problemas },
    });
  }
}

/**
 * Converte uma linha da planilha em `CriarLeadInput` (Camadas 1/2 no nível
 * raiz, Camada 3 em `customFields`), acumulando erros em vez de lançar —
 * o relatório precisa de todos os problemas de todas as linhas de uma vez.
 *
 * @param {LinhaPlanilha} linha
 * @param {Record<string, string>} mapeamento
 * @param {CampoPlanilha[]} campos
 * @param {Map<string, CampoPlanilha>} campoPorChave
 * @param {Map<string, string>} estagioPorNome
 */
export function converterLinha(linha, mapeamento, campos, campoPorChave, estagioPorNome) {
  /** @type {Record<string, unknown> & { customFields: Record<string, unknown> }} */
  const dados = { customFields: {} };
  /** @type {ErroDeLinha[]} */
  const erros = [];

  for (const [coluna, chave] of Object.entries(mapeamento)) {
    const bruto = linha.valores[coluna];
    if (bruto === null || bruto === undefined) continue;

    if (chave === CHAVE_ESTAGIO) {
      const estagioId = estagioPorNome.get(String(bruto).trim().toLowerCase());
      if (estagioId) {
        dados.funilEstagioId = estagioId;
      } else {
        erros.push({ linha: linha.numero, coluna, motivo: `Estágio "${bruto}" não existe no funil` });
      }
      continue;
    }

    const campo = /** @type {CampoPlanilha} */ (campoPorChave.get(chave));
    const resultado = converterValor(campo, bruto);
    if ('erro' in resultado) {
      erros.push({ linha: linha.numero, coluna, motivo: resultado.erro });
    } else if (campo.camada === CAMADA.CAMADA_3) {
      dados.customFields[chave] = resultado.valor;
    } else {
      dados[chave] = resultado.valor;
    }
  }

  for (const campo of campos) {
    if (!campo.obrigatorio) continue;
    const valor = campo.camada === CAMADA.CAMADA_3 ? dados.customFields[campo.chave] : dados[campo.chave];
    if (valorAusente(valor)) {
      erros.push({ linha: linha.numero, motivo: `"${campo.label}" é obrigatório` });
    }
  }
  if (!dados.email && !dados.telefone) {
    erros.push({ linha: linha.numero, motivo: 'Informe e-mail ou telefone' });
  }

  return { dados, erros };
}

/**
 * @param {CampoPlanilha} campo
 * @param {ValorCelula} bruto (nunca `null` aqui)
 * @returns {{ valor: unknown } | { erro: string }}
 */
function converterValor(campo, bruto) {
  const texto = bruto instanceof Date ? bruto.toISOString() : String(bruto).trim();

  if (campo.chave === 'email') {
    return PADRAO_EMAIL.test(texto) ? { valor: texto.toLowerCase() } : { erro: `E-mail inválido: "${texto}"` };
  }
  if (campo.chave === 'telefone') {
    return somenteDigitos(texto).length >= IMPORTACAO.MIN_DIGITOS_TELEFONE
      ? { valor: texto }
      : { erro: `Telefone inválido: "${texto}"` };
  }

  switch (campo.tipo) {
    case 'texto':
      return { valor: texto };
    case 'numero': {
      const numero = typeof bruto === 'number' ? bruto : converterNumero(texto);
      return Number.isFinite(numero) ? { valor: numero } : { erro: `"${campo.label}" espera um número` };
    }
    case 'data': {
      const data = bruto instanceof Date ? bruto : converterData(texto);
      return data && !Number.isNaN(data.getTime())
        ? { valor: data.toISOString() }
        : { erro: `"${campo.label}" espera uma data (dd/mm/aaaa)` };
    }
    case 'booleano': {
      const normalizado = String(bruto).trim().toLowerCase();
      if (bruto === true || VALORES_VERDADEIROS.has(normalizado)) return { valor: true };
      if (bruto === false || VALORES_FALSOS.has(normalizado)) return { valor: false };
      return { erro: `"${campo.label}" espera sim ou não` };
    }
    case 'selecao': {
      const opcao = casarOpcao(campo, texto);
      return opcao !== undefined ? { valor: opcao } : { erro: `"${texto}" não é uma opção de "${campo.label}"` };
    }
    case 'selecao_multipla': {
      const itens = texto.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
      const valores = itens.map((item) => casarOpcao(campo, item));
      const invalido = itens.find((_, i) => valores[i] === undefined);
      return invalido === undefined
        ? { valor: valores }
        : { erro: `"${invalido}" não é uma opção de "${campo.label}"` };
    }
    default:
      return { erro: `Tipo de campo "${campo.tipo}" não suportado` };
  }
}

/**
 * Casa sem diferenciar maiúscula/minúscula e devolve a opção canônica.
 * Sem `opcoes` (ex: `tags`), qualquer valor é aceito.
 *
 * @param {CampoPlanilha} campo
 * @param {string} valor
 */
function casarOpcao(campo, valor) {
  if (!campo.opcoes) return valor;
  return campo.opcoes.find((opcao) => opcao.toLowerCase() === valor.toLowerCase());
}

/** Aceita `1234.5`, `1234,5` e `1.234,50`. @param {string} texto */
function converterNumero(texto) {
  const limpo = texto.replace(/\s/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return normalizado.length > 0 ? Number(normalizado) : Number.NaN;
}

/** Aceita `dd/mm/aaaa` e ISO. @param {string} texto */
function converterData(texto) {
  const br = PADRAO_DATA_BR.exec(texto);
  if (br) {
    const [, dia, mes, ano] = br.map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    // `Date.UTC` datas impossíveis (31/02 → 03/03) em vez de falhar.
    const valida = data.getUTCDate() === dia && data.getUTCMonth() === mes - 1;
    return valida ? data : null;
  }
  return new Date(texto);
}

/** @param {Record<string, unknown>} dados */
function reviverDatas(dados) {
  const revivido = { ...dados };
  for (const chave of CHAVES_DATA_NATIVAS) {
    if (typeof revivido[chave] === 'string') revivido[chave] = new Date(revivido[chave]);
  }
  return revivido;
}

/** @param {string} texto */
function somenteDigitos(texto) {
  return texto.replace(/\D/g, '');
}

/** @param {unknown} valor */
function valorAusente(valor) {
  return valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0);
}

/**
 * Mensagem pro relatório do usuário — erro de banco cru (nome de
 * constraint, SQL) não vaza; só `AppError` tem mensagem pública.
 *
 * @param {unknown} erro
 */
function motivoDoErro(erro) {
  if (erro instanceof AppError) return erro.message;
  return 'Não foi possível gravar esta linha';
}
