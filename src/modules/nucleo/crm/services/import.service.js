import { AppError, erroDeValidacao } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { buscarEstagiosPorTenant } from '../adapters/funil-estagios.repository.js';
import {
  criarImportJob,
  buscarImportJob,
  buscarImportJobComPayload,
  definirAcoesDuplicata,
  transicionarStatus,
  registrarProgresso,
  marcarFalha,
} from '../adapters/import-jobs.repository.js';
import { enfileirarImportacao, encerrarFilaImportacao } from '../adapters/import-queue.repository.js';
import { buscarLeadPorId, criarLead, atualizarLead } from '../adapters/leads.repository.js';
import { listarUsuariosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import {
  ACOES_DUPLICIDADE,
  ACOES_IMPORT_DUPLICATA,
  CAMADA,
  CAMADA_2_COLUNA_PARA_CAMPO,
  CAMADA_2_METADADOS,
  CAMPOS_CAMADA_1,
  CAMPOS_EXTRAS_PLANILHA,
  CHAVE_CAMPO_SCORE,
  IMPORT_JOB_STATUS,
  IMPORTACAO,
  TIPOS_CAMPO,
} from '../constants.js';
import { duplicadosDasLinhas, encontrarDuplicados, regrasDoImport } from './duplicidade.service.js';
import { customFieldsParaArmazenamento, exigidoNaCriacao, obterSchemaCampos } from './field-schema.service.js';
import { diffDoLead } from './historico.service.js';
import { aplicarEdicao, errosDasRegras, leadParaApi, listarCamposDoTenant, regrasAplicaveis } from './leads.service.js';
import { gravarTagsNovas, resolverOpcoesDoLead } from './listas.service.js';
import { agendarEnriquecimento } from './cnpj.service.js';
import { garantirScoreNaoEditado, recalcularScoreDosLeads } from './score.service.js';
import {
  carregarContextoDistribuicao,
  detalhesDaAtribuicao,
  distribuir,
  notificarAtribuicoesDoImport,
} from './distribuicao.service.js';
import { lerPlanilha } from './planilha.service.js';
import { comPrimeiroNomeNaCriacao, comPrimeiroNomeNaEdicao, precisaDoLeadAtual } from './primeiro-nome.service.js';
import { converterCelula, valorAusente } from './tipos-campo.service.js';

/**
 * SERVICE: importação de leads por planilha
 * (docs/crm/plano-campos-filtros-import-export.md §3.3). Fluxo:
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
 * Também aponta, no passo Revisar (M7), as linhas que parecem com leads
 * que já existem (`duplicados`), pelas regras de duplicidade do tenant.
 *
 * @returns {Promise<{ jobId: string | null, totalLinhas: number, linhasValidas: number, erros: ErroDeLinha[], duplicados: object[] }>}
 */
export async function validarImportacao(tenantId, usuarioId, buffer, { mapeamento, estrategiaDuplicata }) {
  const [{ colunas, linhas }, camposDaPlanilha, estagios] = await Promise.all([
    lerPlanilha(buffer),
    listarCamposDaPlanilha(tenantId),
    buscarEstagiosPorTenant(tenantId),
  ]);
  const campos = await comUsuariosDoTenant(tenantId, camposDaPlanilha);

  const campoPorChave = new Map(campos.map((campo) => [campo.chave, campo]));
  validarMapeamento(mapeamento, colunas, campos, campoPorChave);
  // M14: com a pontuação ligada, a coluna Lead score não pode ser importada.
  if (Object.values(mapeamento).includes(CHAVE_CAMPO_SCORE)) {
    await garantirScoreNaoEditado(tenantId, { [CHAVE_CAMPO_SCORE]: true });
  }

  const estagioPorNome = new Map(estagios.map((estagio) => [estagio.nome.trim().toLowerCase(), estagio.id]));
  // Regras do M8: a linha é avaliada como lead novo (o Revisar mostra a violação).
  const schema = await obterSchemaCampos(tenantId);
  const regrasCampos = await regrasAplicaveis(tenantId, schema);

  /** @type {ErroDeLinha[]} */
  const erros = [];
  const payload = [];
  for (const linha of linhas) {
    const resultado = converterLinha(linha, mapeamento, campos, campoPorChave, estagioPorNome);
    const violacoes = resultado.erros.length > 0 ? [] : errosDasRegras(schema, regrasCampos, resultado.dados);
    if (resultado.erros.length > 0) {
      erros.push(...resultado.erros);
    } else if (violacoes.length > 0) {
      erros.push(...violacoes.map((violacao) => ({ linha: linha.numero, motivo: violacao.mensagem })));
    } else {
      payload.push({ linha: linha.numero, dados: resultado.dados });
    }
  }

  if (payload.length === 0) {
    return { jobId: null, totalLinhas: linhas.length, linhasValidas: 0, erros, duplicados: [] };
  }

  const duplicados = await duplicadosDasLinhas(tenantId, payload, await regrasDoImport(tenantId));
  // A ação da regra fica na linha: o confirm não deixa "criar" onde bloqueia.
  const acaoPorLinha = new Map(duplicados.map((duplicado) => [duplicado.linha, duplicado.acao]));
  const payloadMarcado = payload.map((item) =>
    acaoPorLinha.has(item.linha) ? { ...item, duplicata: acaoPorLinha.get(item.linha) } : item,
  );

  const { id: jobId } = await criarImportJob(tenantId, { usuarioId, estrategiaDuplicata, payload: payloadMarcado });
  return { jobId, totalLinhas: linhas.length, linhasValidas: payload.length, erros, duplicados };
}

/**
 * `acoes` (M7, opcional): o que fazer com cada linha duplicada apontada no
 * validate — `{ "<linha>": "pular" | "atualizar" | "criar" }`. Linha sem
 * ação segue a `estrategiaDuplicata` do job. "criar" onde a regra bloqueia → 400.
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {{ acoes?: Record<string, string> }} [opcoes]
 */
export async function confirmarImportacao(tenantId, jobId, { acoes } = {}) {
  if (acoes && Object.keys(acoes).length > 0) await gravarAcoes(tenantId, jobId, acoes);

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
 * @param {Record<string, string>} acoes
 */
async function gravarAcoes(tenantId, jobId, acoes) {
  const job = await buscarImportJobComPayload(tenantId, jobId);
  if (!job) await obterStatusImportacao(tenantId, jobId); // 404
  const duplicataPorLinha = new Map(
    job.payload.filter((item) => item.duplicata).map((item) => [String(item.linha), item.duplicata]),
  );

  for (const [linha, acao] of Object.entries(acoes)) {
    const duplicata = duplicataPorLinha.get(linha);
    if (!duplicata) {
      throw erroDeValidacao('acoes', `A linha ${linha} não foi apontada como duplicada`);
    }
    if (acao === ACOES_IMPORT_DUPLICATA.CRIAR && duplicata === ACOES_DUPLICIDADE.BLOQUEAR) {
      throw erroDeValidacao('acoes', `A linha ${linha} repete um lead existente e a regra não deixa criar outro`);
    }
  }
  // Só grava com o job pendente; já confirmado cai no 409 da transição logo depois.
  await definirAcoesDuplicata(tenantId, jobId, acoes);
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
 * Chamado pelo worker (`src/workers/crm.worker.js`), nunca por
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
    // O payload guarda `customFields` por `chave` (validado no request);
    // as definições de AGORA dão o `id` com que ele é gravado.
    const [[estagioPadrao], schema, regras, distribuicao] = await Promise.all([
      buscarEstagiosPorTenant(tenantId),
      obterSchemaCampos(tenantId),
      regrasDoImport(tenantId),
      carregarContextoDistribuicao(tenantId),
    ]);
    const { definicoes } = schema;
    const regrasCampos = await regrasAplicaveis(tenantId, schema);
    const acoes = job.acoes ?? {};
    /** @type {{ leadId: string, cnpj: unknown }[]} */
    const comCnpj = [];
    /** Leads distribuídos por responsável (M12) — uma notificação por pessoa no fim. */
    const distribuidos = new Map();
    /** Criados ou atualizados — o score (M14) é recalculado de uma vez no fim. */
    const gravados = [];

    for (const item of job.payload) {
      try {
        const dadosApi = reviverDatas(item.dados);
        const dados = { ...dadosApi };
        if (dados.customFields !== undefined) {
          dados.customFields = customFieldsParaArmazenamento(definicoes, dados.customFields);
        }
        const { resultado, motivo, leadId, atribuidoA } = await importarLinha(tenantId, dados, acoes[String(item.linha)] ?? job.estrategia_duplicata, {
          estagioPadraoId: estagioPadrao?.id ?? null,
          responsavelPadraoId: job.usuario_id,
          regras,
          // Lead novo sem responsável na linha (M12): avaliado no formato da API (custom field pela chave).
          distribuirLinha: distribuicao
            ? (tagsResolvidas) => distribuir(tenantId, distribuicao, { ...dadosApi, tags: tagsResolvidas })
            : null,
          // Atualizar um existente: regras do M8 contra o lead resultante.
          validarAtualizacao: async (leadId) => {
            if (regrasCampos.length === 0) return null;
            const atual = await buscarLeadPorId(tenantId, leadId);
            const [violacao] = atual
              ? errosDasRegras(schema, regrasCampos, aplicarEdicao(leadParaApi(atual, schema), dadosApi))
              : [];
            return violacao?.mensagem ?? null;
          },
        });
        progresso[resultado] += 1;
        if (leadId) gravados.push(leadId);
        if (leadId && dados.cnpj) comCnpj.push({ leadId, cnpj: dados.cnpj });
        if (atribuidoA) distribuidos.set(atribuidoA, (distribuidos.get(atribuidoA) ?? 0) + 1);
        if (motivo) progresso.relatorioErro.push({ linha: item.linha, motivo });
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
    // M11b: uma leva só no fim (o worker do CNPJ respeita o rate limit do provedor).
    await agendarEnriquecimento(tenantId, comCnpj);
    await recalcularScoreDosLeads(tenantId, gravados);
    await notificarAtribuicoesDoImport(tenantId, { importJobId: jobId, totais: distribuidos, importadorId: job.usuario_id });
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
 * Duplicado (M7) = lead que casa com alguma regra ativa, conferido de novo
 * aqui (pega também a linha repetida dentro da própria planilha, criada
 * logo antes). Com duplicado: `pular` ignora, `atualizar` atualiza o mais
 * antigo, `criar` cria — menos quando a regra bloqueia: aí a linha é
 * ignorada com o motivo no relatório. Quem importou é o autor no histórico.
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} dadosDaPlanilha
 * @param {string} acao `pular` | `atualizar` | `criar`
 * @param {{
 *   estagioPadraoId: string | null,
 *   responsavelPadraoId: string,
 *   regras: import('./duplicidade.service.js').RegraDuplicidade[],
 *   validarAtualizacao?: (leadId: string) => Promise<string | null>,
 *   distribuirLinha?: ((tags: unknown) => Promise<import('./distribuicao.service.js').Atribuicao>) | null,
 * }} contexto  estágio e responsável padrão só em lead novo — o da coluna Responsável, senão
 *   o da distribuição automática (M12, `distribuirLinha` recebe as tags já como keys), senão
 *   quem importou; `validarAtualizacao` devolve o motivo se a atualização violar uma regra (M8)
 * @returns {Promise<{
 *   resultado: 'linhasCriadas' | 'linhasAtualizadas' | 'linhasIgnoradas' | 'linhasComErro',
 *   motivo?: string, leadId?: string, atribuidoA?: string | null,
 * }>}
 *   `leadId`: o lead gravado (criado ou atualizado) — vai pro enriquecimento por CNPJ (M11b);
 *   `atribuidoA`: quem recebeu pela distribuição automática (M12)
 */
async function importarLinha(
  tenantId,
  dadosDaPlanilha,
  acao,
  { estagioPadraoId, responsavelPadraoId, regras, validarAtualizacao = async () => null, distribuirLinha = null },
) {
  const dados = await comTagsResolvidas(tenantId, dadosDaPlanilha);
  const historico = { autorId: responsavelPadraoId };
  const [existente] = await encontrarDuplicados(tenantId, dados, { regras });

  if (existente) {
    if (acao === ACOES_IMPORT_DUPLICATA.PULAR) return { resultado: 'linhasIgnoradas' };
    if (acao === ACOES_IMPORT_DUPLICATA.ATUALIZAR) {
      const violacao = await validarAtualizacao(existente.id);
      if (violacao) return { resultado: 'linhasComErro', motivo: violacao };
      // Sem estágio padrão aqui de propósito: atualizar não pode mover o
      // lead de estágio só porque a planilha não tinha a coluna.
      const ignorar = dados.ultimaInteracaoEm === undefined ? ['ultimaInteracaoEm'] : [];
      const comPrimeiroNome = comPrimeiroNomeNaEdicao(
        dados,
        precisaDoLeadAtual(dados) ? await buscarLeadPorId(tenantId, existente.id) : null,
      );
      await atualizarLead(tenantId, existente.id, comPrimeiroNome, {
        ...historico,
        montarDiff: (antes, depois) => diffDoLead(antes, depois, { ignorar }),
      });
      return { resultado: 'linhasAtualizadas', leadId: existente.id };
    }
    if (existente.acao === ACOES_DUPLICIDADE.BLOQUEAR) {
      return {
        resultado: 'linhasIgnoradas',
        motivo: `Já existe o lead "${existente.nome}" com ${existente.campos.map((campo) => campo.label).join(', ')}; a regra de duplicidade não deixa criar outro`,
      };
    }
  }

  const atribuicao = dados.usuarioResponsavelId === undefined && distribuirLinha ? await distribuirLinha(dados.tags) : null;
  const criado = await criarLead(
    tenantId,
    {
      ...comPrimeiroNomeNaCriacao(dados),
      funilEstagioId: dados.funilEstagioId ?? estagioPadraoId,
      usuarioResponsavelId: atribuicao ? atribuicao.usuarioId : (dados.usuarioResponsavelId ?? responsavelPadraoId),
      atribuidoPorRegraId: atribuicao?.regraId ?? null,
    },
    atribuicao ? { ...historico, detalhes: detalhesDaAtribuicao(atribuicao) } : historico,
  );
  return { resultado: 'linhasCriadas', leadId: criado?.id, atribuidoA: atribuicao?.usuarioId ?? null };
}

/**
 * Tags da planilha → keys da lista central; tag nova entra na lista (M3.4).
 * Status/origem/motivo já saíram como key na validação (`converterCelula`).
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} dados
 */
async function comTagsResolvidas(tenantId, dados) {
  if (!Array.isArray(dados.tags)) return dados;
  const { listas } = await obterSchemaCampos(tenantId);
  const { input, tagsNovas } = await resolverOpcoesDoLead(listas, { tags: dados.tags });
  await gravarTagsNovas(tenantId, tagsNovas);
  return { ...dados, tags: input.tags };
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
 * Campo do tipo `usuario` (M11): a planilha traz o nome; `converterCelula`
 * troca pelo id de um usuário ativo. Só consulta se houver um desses campos.
 *
 * @template {{ tipo: string }} C
 * @param {string} tenantId
 * @param {C[]} campos
 * @returns {Promise<(C & { usuarios?: Map<string, string> })[]>}
 */
async function comUsuariosDoTenant(tenantId, campos) {
  if (!campos.some((campo) => campo.tipo === TIPOS_CAMPO.USUARIO)) return campos;
  const usuarios = new Map(
    (await listarUsuariosAtivosDoTenant(tenantId)).map((usuario) => [usuario.nome.trim().toLowerCase(), usuario.id]),
  );
  return campos.map((campo) => (campo.tipo === TIPOS_CAMPO.USUARIO ? { ...campo, usuarios } : campo));
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
    if (exigidoNaCriacao(campo) && !chavesMapeadas.includes(campo.chave)) {
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
    const resultado = converterCelula(campo, bruto);
    if ('erro' in resultado) {
      erros.push({ linha: linha.numero, coluna, motivo: resultado.erro });
    } else if (campo.camada === CAMADA.CAMADA_3) {
      dados.customFields[chave] = resultado.valor;
    } else {
      dados[chave] = resultado.valor;
    }
  }

  for (const campo of campos) {
    if (!exigidoNaCriacao(campo)) continue;
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

/** @param {Record<string, unknown>} dados */
function reviverDatas(dados) {
  const revivido = { ...dados };
  for (const chave of CHAVES_DATA_NATIVAS) {
    if (typeof revivido[chave] === 'string') revivido[chave] = new Date(revivido[chave]);
  }
  return revivido;
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
