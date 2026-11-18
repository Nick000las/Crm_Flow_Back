/**
 * @file SERVICE: resposta do formulário (FM4).
 */
import { createHash, randomUUID } from 'node:crypto';

import { AppError, erroNaoEncontrado } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

import {
  buscarResposta,
  buscarRespostasDaPessoa,
  gravarResposta,
  gravarRespostaSemEditarPessoa,
  travarLinkParaEnvio,
} from '../adapters/crm-form-submissions.repository.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import {
  ACOES_DUPLICIDADE,
  CAMADA,
  CAMPOS_DUPLICIDADE,
  MOTIVOS_ESCRITA,
  POLITICAS_ESCRITA,
  QUEM_PREENCHE,
  RESULTADOS_ESCRITA,
} from '../constants.js';
import { encontrarDuplicados } from './duplicidade.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { alertasDaResposta } from './formulario-alertas.service.js';
import { indisponivel, resolverLink, valorDaPessoa } from './formulario-publico.service.js';
import { regraDeVisibilidade } from './formulario-visibilidade.service.js';
import { camposElegiveis, comPadroes, ehPergunta } from './formularios.service.js';
import { atualizarLeadExistente } from './leads.service.js';
import { normalizarValorDoTipo, valorAusente, valorValidoParaTipo } from './tipos-campo.service.js';

/**
 * SERVICE: resposta do formulário (FM4).
 *
 * A pessoa envia pela página pública. Cada campo do CRM respondido segue a
 * política do item: `overwrite` grava; `fill_if_empty` só grava se a pessoa
 * não tinha valor. Valor igual ao salvo é ignorado. Contato que já é de outra
 * pessoa, valor diferente num campo `fill_if_empty` e o que as regras do CRM
 * recusam vão para revisão, sem gravar. Resposta vazia nunca apaga dado.
 * As perguntas próprias ficam só na resposta.
 *
 * A escrita na pessoa usa o mesmo caminho da ficha (`atualizarLeadExistente`,
 * sem autor) e, na mesma transação, com a pessoa e o link travados, grava a
 * resposta, fecha o link e publica `form.submitted`. O `write_report` diz o
 * que aconteceu com cada campo.
 *
 * @typedef {import('../adapters/crm-form-public.repository.js').LinkPublico} LinkPublico
 * @typedef {{ campoId: string, label: string, resultado: string, motivo?: string }} LinhaDoRelatorio
 */

/** Contato e documento: o valor não pode já ser de outra pessoa. */
const CHAVES_DE_CONTATO = Object.freeze(Object.keys(CAMPOS_DUPLICIDADE));

/** Na resposta, todas as regras de duplicidade valem, ligadas ou não no tenant. */
const REGRAS_DA_RESPOSTA = Object.freeze(
  CHAVES_DE_CONTATO.map((campo) => ({ campo, acao: ACOES_DUPLICIDADE.AVISAR, ativo: true })),
);

/** A pessoa mudou entre o plano e a gravação: planeja de novo. */
const PESSOA_MUDOU = Symbol('pessoa mudou');
const TENTATIVAS = 2;

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/**
 * JSON com as chaves em ordem, para comparar valores.
 *
 * @param {unknown} valor
 * @returns {string}
 */
function canonico(valor) {
  if (valor instanceof Date) {
    return JSON.stringify(valor.toISOString());
  }

  if (Array.isArray(valor)) {
    return `[${valor.map(canonico).join(',')}]`;
  }

  if (valor && typeof valor === 'object') {
    const chaves = Object.keys(valor).sort();

    return `{${chaves.map((chave) => `${JSON.stringify(chave)}:${canonico(valor[chave])}`).join(',')}}`;
  }

  return JSON.stringify(valor ?? null);
}

/**
 * Itens da versão, em ordem, com o tipo e as opções que a resposta valida.
 *
 * @param {object[]} secoes  `sections` da versão
 * @param {Record<string, any>} retratos  `fields_snapshot` da versão
 */
export function itensDaVersao(secoes, retratos) {
  return comPadroes(/** @type {any[]} */ (secoes)).flatMap((secao) =>
    secao.itens.map((item) => {
      if (ehPergunta(item)) {
        const { pergunta } = /** @type {any} */ (item);

        return {
          chave: pergunta.id,
          ehPergunta: true,
          label: pergunta.rotulo,
          tipo: pergunta.tipo,
          opcoes: pergunta.opcoes ?? null,
          obrigatorio: item.obrigatorio,
          sensivel: pergunta.sensivel ?? false,
        };
      }

      const { campoId, obrigatorio, politica } = /** @type {any} */ (item);
      const retrato = retratos[campoId] ?? {};

      return {
        chave: campoId,
        ehPergunta: false,
        label: retrato.label,
        tipo: retrato.tipo,
        opcoes: retrato.opcoes ?? null,
        obrigatorio,
        politica,
        sensivel: retrato.sensivel ?? false,
      };
    }),
  );
}

/**
 * Confere as respostas contra a versão: só itens do formulário, obrigatório
 * respondido, valor válido para o tipo. Devolve os valores normalizados.
 *
 * @param {ReturnType<typeof itensDaVersao>} itens
 * @param {Record<string, unknown>} respostas  `{ <campoId | perguntaId>: valor }`
 * @returns {{ campos: Record<string, unknown>, perguntas: Record<string, unknown> }}
 */
export function validarRespostas(itens, respostas) {
  /** @type {Record<string, string[]>} */
  const erros = {};
  const conhecidas = new Set(itens.map((item) => item.chave));

  for (const chave of Object.keys(respostas)) {
    if (!conhecidas.has(chave)) {
      erros[`respostas.${chave}`] = ['Esta pergunta não está no formulário'];
    }
  }

  const campos = {};
  const perguntas = {};

  for (const item of itens) {
    const bruto = respostas[item.chave];
    const valor = typeof bruto === 'string' ? bruto.trim() : bruto;

    if (valorAusente(valor)) {
      if (item.obrigatorio) {
        erros[`respostas.${item.chave}`] = ['Responda esta pergunta'];
      }

      continue;
    }

    if (!valorValidoParaTipo(item.tipo, valor, item.opcoes)) {
      erros[`respostas.${item.chave}`] = [`Resposta inválida para "${item.label}"`];
      continue;
    }

    (item.ehPergunta ? perguntas : campos)[item.chave] = normalizarValorDoTipo(item.tipo, valor);
  }

  if (Object.keys(erros).length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Revise as respostas destacadas',
      fields: erros,
    });
  }

  return { campos, perguntas };
}

/**
 * O que fazer com cada campo do CRM, contra o valor atual da pessoa. Sem
 * consultar duplicidade (ver `planejarEscrita`).
 *
 * @param {ReturnType<typeof itensDaVersao>} itens
 * @param {Record<string, unknown>} valores  dos campos, já validados
 * @param {Record<string, any>} pessoa  linha de `leads`
 * @param {Map<string, { id: string, chave: string, camada: number }>} elegiveisAgora
 * @returns {{ relatorio: LinhaDoRelatorio[], aGravar: { campoId: string, chave: string, camada: number, valor: unknown }[] }}
 */
export function planejarPelaPolitica(itens, valores, pessoa, elegiveisAgora) {
  const relatorio = [];
  const aGravar = [];

  for (const item of itens.filter((candidato) => !candidato.ehPergunta)) {
    const linha = { campoId: item.chave, label: item.label };

    if (!(item.chave in valores)) {
      relatorio.push({
        ...linha,
        resultado: RESULTADOS_ESCRITA.IGNORADO,
        motivo: MOTIVOS_ESCRITA.SEM_RESPOSTA,
      });

      continue;
    }

    const atual = elegiveisAgora.get(item.chave);

    if (!atual) {
      // Campo desligado ou removido depois da publicação: não há onde gravar.
      relatorio.push({
        ...linha,
        resultado: RESULTADOS_ESCRITA.REVISAO,
        motivo: MOTIVOS_ESCRITA.CAMPO_INDISPONIVEL,
      });

      continue;
    }

    const salvo = valorDaPessoa(pessoa, atual);

    if (canonico(salvo) === canonico(valores[item.chave])) {
      relatorio.push({
        ...linha,
        resultado: RESULTADOS_ESCRITA.IGNORADO,
        motivo: MOTIVOS_ESCRITA.IGUAL,
      });

      continue;
    }

    if (item.politica === POLITICAS_ESCRITA.PREENCHER_SE_VAZIO && !valorAusente(salvo)) {
      relatorio.push({
        ...linha,
        resultado: RESULTADOS_ESCRITA.REVISAO,
        motivo: MOTIVOS_ESCRITA.VALOR_DIFERENTE,
      });

      continue;
    }

    relatorio.push({ ...linha, resultado: RESULTADOS_ESCRITA.GRAVADO });

    aGravar.push({
      campoId: item.chave,
      chave: atual.chave,
      camada: atual.camada,
      valor: valores[item.chave],
    });
  }

  return { relatorio, aGravar };
}

/**
 * Entrada no formato da edição do lead (`atualizarLeadExistente`).
 *
 * @param {{ chave: string, camada: number, valor: unknown }[]} aGravar
 */
export function entradaDoLead(aGravar) {
  const entrada = {};
  const customFields = {};

  for (const { chave, camada, valor } of aGravar) {
    if (camada === CAMADA.CAMADA_3) {
      customFields[chave] = valor;
    } else {
      entrada[chave] = valor;
    }
  }

  return Object.keys(customFields).length > 0 ? { ...entrada, customFields } : entrada;
}

/** @param {LinhaDoRelatorio[]} relatorio @param {Set<string>} campoIds @param {string} motivo */
function paraRevisao(relatorio, campoIds, motivo) {
  return relatorio.map((linha) =>
    campoIds.has(linha.campoId)
      ? { ...linha, resultado: RESULTADOS_ESCRITA.REVISAO, motivo }
      : linha,
  );
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/**
 * Plano completo: política e, para contato e documento, se o valor já é de
 * outra pessoa.
 *
 * @param {string} tenantId
 * @param {LinkPublico} link
 * @param {ReturnType<typeof itensDaVersao>} itens
 * @param {Record<string, unknown>} valores
 */
async function planejarEscrita(tenantId, link, itens, valores) {
  const [pessoa, { campos }] = await Promise.all([
    buscarLeadPorId(tenantId, link.lead_id),
    obterSchemaCampos(tenantId),
  ]);

  if (!pessoa || pessoa.anonimizado_em || pessoa.archived_at) {
    throw indisponivel();
  }

  const elegiveisAgora = new Map(camposElegiveis(campos).map((campo) => [campo.id, campo]));
  let { relatorio, aGravar } = planejarPelaPolitica(itens, valores, pessoa, elegiveisAgora);

  const contatos = aGravar.filter((item) => CHAVES_DE_CONTATO.includes(item.chave));

  if (contatos.length > 0) {
    const duplicados = await encontrarDuplicados(
      tenantId,
      Object.fromEntries(contatos.map((item) => [item.chave, item.valor])),
      { ignorarId: link.lead_id, regras: REGRAS_DA_RESPOSTA },
    );
    const deOutraPessoa = new Set(duplicados.flatMap((dup) => dup.campos.map((c) => c.campo)));
    const recusados = new Set(
      contatos.filter((item) => deOutraPessoa.has(item.chave)).map((item) => item.campoId),
    );

    if (recusados.size > 0) {
      relatorio = paraRevisao(relatorio, recusados, MOTIVOS_ESCRITA.CONTATO_DE_OUTRA_PESSOA);
      aGravar = aGravar.filter((item) => !recusados.has(item.campoId));
    }
  }

  return { pessoa, relatorio, aGravar };
}

/** Erro de validação de regra do CRM: a resposta vai, os campos não. */
function recusadoPelasRegras(erro) {
  return erro instanceof AppError && erro.statusCode === HTTP_STATUS.BAD_REQUEST;
}

/**
 * `POST /public/f/:token/respostas`.
 *
 * @param {unknown} token
 * @param {{ respostas: Record<string, unknown>, preenchidoPor: string, nomeResponsavel?: string | null }} corpo
 *   já validado pelo schema (o aceite do termo é obrigatório lá)
 * @param {{ ip: string | null, userAgent: string | null }} origem
 * @returns {Promise<{ linkId: string, respostaId: string }>}
 */
export async function enviarResposta(token, corpo, origem) {
  const { tenantId, link } = await resolverLink(token);
  const itens = itensDaVersao(link.secoes, link.campos);
  const valores = validarRespostas(itens, corpo.respostas);
  const alertas = alertasDaResposta(/** @type {any[]} */ (link.alertas ?? []), itens, valores);
  const respostaId = randomUUID();

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    const { pessoa, relatorio, aGravar } = await planejarEscrita(
      tenantId,
      link,
      itens,
      valores.campos,
    );
    /** @param {LinhaDoRelatorio[]} relatorioFinal */
    const resposta = (relatorioFinal) => ({
      id: respostaId,
      formularioId: link.formulario_id,
      formularioNome: link.formulario_nome,
      versaoId: link.versao_id,
      linkId: link.id,
      leadId: link.lead_id,
      oportunidadeId: link.oportunidade_id,
      respostas: valores,
      hashDoTermo: createHash('sha256').update(link.termo, 'utf8').digest(),
      preenchidoPor: corpo.preenchidoPor,
      nomeResponsavel:
        corpo.preenchidoPor === QUEM_PREENCHE.RESPONSAVEL ? (corpo.nomeResponsavel ?? null) : null,
      ip: origem.ip,
      userAgent: origem.userAgent,
      relatorio: relatorioFinal,
      alertas,
    });

    const semEscrita = async (relatorioFinal) => {
      if (!(await gravarRespostaSemEditarPessoa(tenantId, resposta(relatorioFinal)))) {
        throw indisponivel();
      }

      return { linkId: link.id, respostaId };
    };

    if (aGravar.length === 0) {
      return semEscrita(relatorio);
    }

    try {
      await atualizarLeadExistente(
        tenantId,
        link.lead_id,
        { ...entradaDoLead(aGravar), ignorarDuplicados: true },
        null,
        {
          transacao: {
            conferir: async (travado, tx) => {
              if (
                new Date(travado.updated_at).getTime() !== new Date(pessoa.updated_at).getTime()
              ) {
                throw PESSOA_MUDOU;
              }

              if (!(await travarLinkParaEnvio(tx, tenantId, link.id))) {
                throw indisponivel();
              }
            },
            depoisDeGravar: (tx) => gravarResposta(tx, tenantId, resposta(relatorio)),
            detalhes: { origem: 'formulario', formularioId: link.formulario_id, respostaId },
          },
        },
      );

      return { linkId: link.id, respostaId };
    } catch (erro) {
      if (erro === PESSOA_MUDOU && tentativa < TENTATIVAS) {
        continue;
      }

      if (erro === PESSOA_MUDOU) {
        throw indisponivel();
      }

      if (recusadoPelasRegras(erro)) {
        const recusados = new Set(aGravar.map((item) => item.campoId));

        return semEscrita(paraRevisao(relatorio, recusados, MOTIVOS_ESCRITA.REGRA_DO_CRM));
      }

      if (erro instanceof AppError && erro.statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        throw indisponivel();
      }

      throw erro;
    }
  }

  throw indisponivel();
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

/** @param {LinhaDoRelatorio[]} relatorio */
function contagem(relatorio) {
  const contar = (resultado) => relatorio.filter((linha) => linha.resultado === resultado).length;

  return {
    gravados: contar(RESULTADOS_ESCRITA.GRAVADO),
    ignorados: contar(RESULTADOS_ESCRITA.IGNORADO),
    revisao: contar(RESULTADOS_ESCRITA.REVISAO),
  };
}

/** @param {import('../adapters/crm-form-submissions.repository.js').RespostaResumo} linha */
function resumoParaApi(linha) {
  return {
    id: linha.id,
    formulario: { id: linha.formulario_id, nome: linha.formulario_nome },
    versao: { id: linha.versao_id, versao: linha.versao },
    linkId: linha.link_id,
    oportunidadeId: linha.oportunidade_id,
    preenchidoPor: linha.preenchido_por,
    nomeResponsavel: linha.nome_responsavel,
    respondidoEm: linha.respondido_em,
    escrita: contagem(/** @type {LinhaDoRelatorio[]} */ (linha.relatorio)),
  };
}

/**
 * Respostas da pessoa, sem os valores.
 *
 * @param {string} tenantId
 * @param {string} leadId
 */
export async function listarRespostasDaPessoa(tenantId, leadId) {
  return (await buscarRespostasDaPessoa(tenantId, leadId)).map(resumoParaApi);
}

/**
 * Uma resposta, como foi enviada, na versão que a pessoa viu. Campo que o
 * papel não vê e pergunta sensível (só gestão) saem com `oculto: true` e sem
 * valor. IP e navegador só para a gestão.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} respostaId
 * @param {string | undefined} papel
 */
export async function obterResposta(tenantId, leadId, respostaId, papel) {
  const linha = await buscarResposta(tenantId, leadId, respostaId);

  if (!linha) {
    throw erroNaoEncontrado('Resposta não encontrada');
  }

  const { gestao, veCampo, vePergunta } = await regraDeVisibilidade(tenantId, papel);
  const relatorio = new Map(
    /** @type {LinhaDoRelatorio[]} */ (linha.relatorio).map((item) => [item.campoId, item]),
  );

  const secoes = comPadroes(/** @type {any[]} */ (linha.secoes)).map((secao) => ({
    titulo: secao.titulo,
    itens: secao.itens.map((item) => {
      if (ehPergunta(item)) {
        const { pergunta } = /** @type {any} */ (item);
        const oculto = !vePergunta(pergunta.sensivel);

        return {
          pergunta: {
            id: pergunta.id,
            rotulo: pergunta.rotulo,
            tipo: pergunta.tipo,
            opcoes: pergunta.opcoes,
          },
          ...(oculto
            ? { oculto: true }
            : { valor: linha.respostas.perguntas?.[pergunta.id] ?? null }),
        };
      }

      const { campoId } = /** @type {any} */ (item);
      const retrato = linha.campos[campoId] ?? {};
      const oculto = !veCampo(campoId, retrato);
      const escrita = relatorio.get(campoId);

      return {
        campoId,
        campo: {
          label: retrato.label,
          tipo: retrato.tipo,
          opcoes: retrato.opcoes ?? null,
          ...(retrato.opcoesLista ? { opcoesLista: retrato.opcoesLista } : {}),
        },
        ...(oculto ? { oculto: true } : { valor: linha.respostas.campos?.[campoId] ?? null }),
        escrita: escrita ? { resultado: escrita.resultado, motivo: escrita.motivo ?? null } : null,
      };
    }),
  }));

  return {
    ...resumoParaApi(linha),
    termo: linha.termo,
    aceitoEm: linha.aceito_em,
    secoes,
    ...(gestao ? { origem: { ip: linha.ip, navegador: linha.user_agent } } : {}),
  };
}
