import { randomUUID } from 'node:crypto';
import {
  AppError,
  erroDeConflito,
  erroDeValidacao,
  erroNaoEncontrado,
} from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  atualizarFormulario,
  buscarFormulario,
  buscarFormularios,
  buscarVersao,
  buscarVersoes,
  contarFormularios,
  inserirFormulario,
  inserirVersao,
  nomeEmUso,
} from '../adapters/crm-forms.repository.js';
import {
  CAMADA,
  CHAVES_PREENCHER_SE_VAZIO,
  CHAVES_SISTEMA_DO_FORMULARIO,
  LIMITES_FORMULARIO,
  POLITICAS_ESCRITA,
  TIPOS_FORA_DO_FORMULARIO,
  OPERADORES_POR_TIPO,
  TIPOS_CAMPO,
  TIPOS_PERGUNTA_COM_OPCOES,
} from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { normalizarValorDoTipo, valorValidoParaTipo } from './tipos-campo.service.js';

/**
 * SERVICE: formulários (FM1, docs/produto/crm-formularios.md).
 *
 * O formulário junta campos da pessoa que já existem no CRM, cada um ligado
 * pelo dono (decisão de 07/11/2026), e perguntas próprias, cuja resposta fica
 * só na resposta do formulário (FM2b). Um campo pode vir pré-preenchido com o
 * valor salvo, menos o sensível. O rascunho é editado à vontade; publicar
 * valida e grava uma versão imutável, com o retrato de cada campo, que é o que
 * o link e a resposta usam.
 *
 * @typedef {import('../adapters/crm-forms.repository.js').FormularioLinha} FormularioLinha
 * @typedef {import('../adapters/crm-forms.repository.js').VersaoLinha} VersaoLinha
 * @typedef {{ campoId: string, obrigatorio: boolean, politica: string, preencher: boolean }} ItemCampo
 * @typedef {{
 *   id: string, rotulo: string, ajuda: string | null, tipo: string,
 *   opcoes: string[] | null, sensivel: boolean,
 * }} Pergunta
 * @typedef {{ pergunta: Pergunta, obrigatorio: boolean }} ItemPergunta
 * @typedef {ItemCampo | ItemPergunta} Item
 * @typedef {{ titulo: string | null, itens: Item[] }} Secao
 * @typedef {{
 *   id: string, alvo: { campoId: string } | { perguntaId: string }, operador: string,
 *   valor?: unknown, nivel: string, texto: string,
 * }} Alerta
 * @typedef {{ secoes: Secao[], introducao: string | null, termo: string | null, alertas: Alerta[] }} Rascunho
 * @typedef {{
 *   id: string, chave: string, label: string, tipo: string, camada: number,
 *   sensivel: boolean, opcoes: readonly string[] | null,
 *   opcoesLista?: { key: string, label: string }[], politicaPadrao: string,
 *   podePreencher: boolean,
 * }} CampoElegivel
 */

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/**
 * Campos da pessoa que um formulário pode pedir: os do sistema que a pessoa
 * responde e os personalizados, desde que ligados no CRM.
 *
 * @param {import('./field-schema.service.js').SchemaCampos['campos']} campos  o schema do tenant
 * @returns {CampoElegivel[]}
 */
export function camposElegiveis(campos) {
  return campos
    .filter((campo) => campo.id)
    .filter((campo) =>
      campo.camada === CAMADA.CAMADA_3
        ? !TIPOS_FORA_DO_FORMULARIO.includes(campo.tipo)
        : CHAVES_SISTEMA_DO_FORMULARIO.includes(campo.chave),
    )
    .map((campo) => ({
      id: /** @type {string} */ (campo.id),
      chave: campo.chave,
      label: campo.label,
      tipo: campo.tipo,
      camada: campo.camada,
      sensivel: campo.sensivel ?? false,
      opcoes: campo.opcoes ?? null,
      ...(campo.opcoesLista ? { opcoesLista: campo.opcoesLista } : {}),
      politicaPadrao: CHAVES_PREENCHER_SE_VAZIO.includes(campo.chave)
        ? POLITICAS_ESCRITA.PREENCHER_SE_VAZIO
        : POLITICAS_ESCRITA.SOBRESCREVER,
      // Link vazado ou encaminhado não mostra dado sensível já salvo.
      podePreencher: !(campo.sensivel ?? false),
    }));
}

/**
 * @param {unknown} item
 * @returns {boolean}
 */
export function ehPergunta(item) {
  return Boolean(item) && typeof item === 'object' && 'pergunta' in /** @type {object} */ (item);
}

/**
 * Normaliza a pergunta e anota os erros dela em `erros`.
 *
 * @param {{ id?: string, rotulo: string, ajuda?: string | null, tipo: string, opcoes?: string[] | null, sensivel?: boolean }} entrada
 * @param {string} caminho  `rascunho.secoes.<s>.itens.<i>.pergunta`
 * @param {Record<string, string[]>} erros
 * @returns {Pergunta}
 */
function normalizarPergunta(entrada, caminho, erros) {
  const comOpcoes = TIPOS_PERGUNTA_COM_OPCOES.includes(entrada.tipo);
  const opcoes = (entrada.opcoes ?? []).map((opcao) => opcao.trim()).filter(Boolean);
  if (comOpcoes && opcoes.length === 0) {
    erros[`${caminho}.opcoes`] = ['Escreva ao menos uma opção'];
  } else if (!comOpcoes && opcoes.length > 0) {
    erros[`${caminho}.opcoes`] = ['Só pergunta de seleção tem opções'];
  } else if (new Set(opcoes.map((opcao) => opcao.toLowerCase())).size !== opcoes.length) {
    erros[`${caminho}.opcoes`] = ['Há opções repetidas'];
  }
  return {
    id: entrada.id ?? randomUUID(),
    rotulo: entrada.rotulo.trim(),
    ajuda: entrada.ajuda?.trim() || null,
    tipo: entrada.tipo,
    opcoes: comOpcoes ? opcoes : null,
    sensivel: entrada.sensivel ?? false,
  };
}

/** Operadores sem valor: a condição é só "respondeu" ou "não respondeu". */
const OPERADORES_SEM_VALOR = Object.freeze(['vazio', 'nao_vazio']);

/**
 * Tipo de cada valor de uma lista ou intervalo: seleção múltipla compara
 * opção a opção; intervalo de datas compara datas.
 *
 * @param {string} tipo
 */
function tipoDoElemento(tipo) {
  if (tipo === TIPOS_CAMPO.SELECAO_MULTIPLA) return TIPOS_CAMPO.SELECAO;
  if (tipo === TIPOS_CAMPO.INTERVALO_DATAS) return TIPOS_CAMPO.DATA;
  return tipo;
}

/**
 * Valor da condição do alerta, conferido contra o tipo do alvo. Mesmos
 * operadores do filtro (`OPERADORES_POR_TIPO`) e o mesmo sentido de
 * `avaliarCondicao`.
 *
 * @param {{ tipo: string, opcoes: readonly string[] | null }} alvo
 * @param {string} operador
 * @param {unknown} valor
 * @returns {{ valor?: unknown } | { erro: string }}
 */
export function valorDaCondicao(alvo, operador, valor) {
  const { tipo, opcoes } = alvo;
  if (!OPERADORES_POR_TIPO[tipo]?.includes(operador)) {
    return { erro: `O operador "${operador}" não vale para este tipo de resposta` };
  }
  if (OPERADORES_SEM_VALOR.includes(operador)) return {};
  const elemento = tipoDoElemento(tipo);
  const valido = (item) => valorValidoParaTipo(elemento, item, opcoes);
  switch (operador) {
    case 'igual':
      return valorValidoParaTipo(tipo, valor, opcoes)
        ? { valor: normalizarValorDoTipo(tipo, valor) }
        : { erro: 'Valor inválido para este tipo de resposta' };
    case 'contem':
      if (tipo === TIPOS_CAMPO.SELECAO_MULTIPLA) {
        return valido(valor) ? { valor } : { erro: 'Escolha uma das opções' };
      }
      return typeof valor === 'string' && valor.trim().length > 0
        ? { valor: valor.trim() }
        : { erro: 'Escreva o texto a procurar' };
    case 'e_um_dos':
      return Array.isArray(valor) && valor.length > 0 && valor.every(valido)
        ? { valor: valor.map((item) => normalizarValorDoTipo(elemento, item)) }
        : { erro: 'Escolha ao menos um valor válido' };
    case 'entre': {
      const intervalo = /** @type {{ de?: unknown, ate?: unknown }} */ (valor ?? {});
      const limites = [intervalo.de, intervalo.ate].filter(
        (item) => item !== undefined && item !== null,
      );
      return typeof valor === 'object' && limites.length > 0 && limites.every(valido)
        ? { valor: { de: intervalo.de ?? null, ate: intervalo.ate ?? null } }
        : { erro: 'Informe o início, o fim ou os dois' };
    }
    default:
      return { erro: 'Operador inválido' };
  }
}

/**
 * Normaliza as regras de alerta e anota os erros. O alvo tem de ser um item
 * do rascunho já normalizado.
 *
 * @param {any[]} entrada
 * @param {Secao[]} secoes  já normalizadas
 * @param {Map<string, CampoElegivel>} porId
 * @param {Record<string, string[]>} erros
 * @returns {Alerta[]}
 */
function normalizarAlertas(entrada, secoes, porId, erros) {
  const alvos = new Map();
  for (const item of secoes.flatMap((secao) => secao.itens)) {
    if (ehPergunta(item)) {
      const { pergunta } = /** @type {ItemPergunta} */ (item);
      alvos.set(`p:${pergunta.id}`, { tipo: pergunta.tipo, opcoes: pergunta.opcoes });
    } else {
      const campo = porId.get(/** @type {ItemCampo} */ (item).campoId);
      if (campo) alvos.set(`c:${campo.id}`, { tipo: campo.tipo, opcoes: campo.opcoes });
    }
  }
  const ids = new Set();
  return entrada.map((alerta, posicao) => {
    const base = `rascunho.alertas.${posicao}`;
    const alvo = alerta.alvo?.campoId
      ? { campoId: alerta.alvo.campoId }
      : { perguntaId: alerta.alvo?.perguntaId };
    const chave = 'campoId' in alvo ? `c:${alvo.campoId}` : `p:${alvo.perguntaId}`;
    const doAlvo = alvos.get(chave);
    let valor;
    if (!doAlvo) {
      erros[`${base}.alvo`] = ['O alerta precisa ser sobre um campo ou pergunta deste formulário'];
    } else {
      const resultado = valorDaCondicao(doAlvo, alerta.operador, alerta.valor);
      if ('erro' in resultado) erros[`${base}.operador`] = [resultado.erro];
      else valor = resultado.valor;
    }
    const id = alerta.id ?? randomUUID();
    if (ids.has(id)) erros[`${base}.id`] = ['Este alerta já está no formulário'];
    ids.add(id);
    return {
      id,
      alvo,
      operador: alerta.operador,
      ...(valor === undefined ? {} : { valor }),
      nivel: alerta.nivel,
      texto: alerta.texto.trim(),
    };
  });
}

/**
 * Normaliza e confere o rascunho. Item de campo aponta para um campo
 * elegível, sem repetir, herda a política padrão do campo e só vem
 * pré-preenchido se o campo não for sensível. Pergunta própria ganha um id
 * se não tiver, e o id não se repete. Para publicar, também exige ao menos um
 * item e o termo de aceite. Alerta (FM5) precisa apontar para um item do
 * rascunho, com operador e valor que valem para o tipo dele.
 *
 * @param {{ secoes?: { titulo?: string | null, itens?: object[] }[], introducao?: string | null, termo?: string | null, alertas?: any[] }} entrada
 * @param {CampoElegivel[]} elegiveis
 * @param {{ publicar?: boolean }} [opcoes]
 * @returns {Rascunho}
 */
export function validarRascunho(entrada, elegiveis, { publicar = false } = {}) {
  const porId = new Map(elegiveis.map((campo) => [campo.id, campo]));
  /** @type {Record<string, string[]>} */
  const erros = {};
  const usados = new Set();
  const perguntasUsadas = new Set();
  let total = 0;

  /**
   * @param {any} item
   * @param {string} base  `rascunho.secoes.<s>.itens.<i>`
   * @returns {Item}
   */
  const normalizarItem = (item, base) => {
    total += 1;
    if (ehPergunta(item)) {
      const pergunta = normalizarPergunta(item.pergunta, `${base}.pergunta`, erros);
      if (perguntasUsadas.has(pergunta.id)) {
        erros[`${base}.pergunta.id`] = ['Esta pergunta já está no formulário'];
      }
      perguntasUsadas.add(pergunta.id);
      return { pergunta, obrigatorio: item.obrigatorio ?? false };
    }
    const caminho = `${base}.campoId`;
    const campo = porId.get(item.campoId);
    if (!campo) erros[caminho] = ['Escolha um campo da pessoa que esteja ligado no CRM'];
    else if (usados.has(item.campoId)) erros[caminho] = [`"${campo.label}" já está no formulário`];
    usados.add(item.campoId);
    const preencher = item.preencher ?? false;
    if (preencher && campo && !campo.podePreencher) {
      erros[`${base}.preencher`] = [`"${campo.label}" é sensível: não pode vir preenchido`];
    }
    return {
      campoId: item.campoId,
      obrigatorio: item.obrigatorio ?? false,
      politica: item.politica ?? campo?.politicaPadrao ?? POLITICAS_ESCRITA.SOBRESCREVER,
      preencher,
    };
  };

  const secoes = (entrada.secoes ?? []).map((secao, s) => ({
    titulo: secao.titulo?.trim() || null,
    itens: (secao.itens ?? []).map((item, i) =>
      normalizarItem(item, `rascunho.secoes.${s}.itens.${i}`),
    ),
  }));

  const alertas = normalizarAlertas(entrada.alertas ?? [], secoes, porId, erros);
  const termo = entrada.termo?.trim() || null;
  if (publicar && total === 0) {
    erros['rascunho.secoes'] = ['Escolha ao menos um campo ou pergunta para publicar'];
  }
  if (publicar && !termo) {
    erros['rascunho.termo'] = ['Escreva o termo de aceite para publicar'];
  }
  if (total > LIMITES_FORMULARIO.ITENS) {
    erros['rascunho.secoes'] = [`No máximo ${LIMITES_FORMULARIO.ITENS} itens por formulário`];
  }
  if (Object.keys(erros).length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: publicar ? 'O formulário não pode ser publicado assim' : 'Revise o formulário',
      fields: erros,
    });
  }
  return { secoes, introducao: entrada.introducao?.trim() || null, termo, alertas };
}

/**
 * Retrato dos campos usados, como estão agora: a versão continua legível
 * mesmo se o campo for renomeado ou desligado depois. A pergunta própria não
 * precisa de retrato: ela inteira já fica na seção.
 *
 * @param {Rascunho} rascunho já validado
 * @param {CampoElegivel[]} elegiveis
 * @returns {Record<string, Omit<CampoElegivel, 'id' | 'politicaPadrao'>>}
 */
export function retratoDosCampos(rascunho, elegiveis) {
  const porId = new Map(elegiveis.map((campo) => [campo.id, campo]));
  return Object.fromEntries(
    rascunho.secoes
      .flatMap((secao) => secao.itens)
      .filter((item) => !ehPergunta(item))
      .map((item) => {
        const { campoId } = /** @type {ItemCampo} */ (item);
        const campo = /** @type {CampoElegivel} */ (porId.get(campoId));
        return [
          campoId,
          {
            chave: campo.chave,
            label: campo.label,
            tipo: campo.tipo,
            camada: campo.camada,
            sensivel: campo.sensivel,
            opcoes: campo.opcoes,
            ...(campo.opcoesLista ? { opcoesLista: campo.opcoesLista } : {}),
          },
        ];
      }),
  );
}

/**
 * JSON com as chaves em ordem: o `jsonb` reordena as chaves ao gravar.
 *
 * @param {unknown} valor
 * @returns {string}
 */
function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    const chaves = Object.keys(valor).sort();
    return `{${chaves.map((chave) => `${JSON.stringify(chave)}:${canonico(valor[chave])}`).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

/**
 * Seções no formato atual: item de campo gravado antes da FM2b não tem
 * `preencher`, e vale desligado.
 *
 * @param {{ titulo: string | null, itens: any[] }[]} secoes
 * @returns {Secao[]}
 */
export function comPadroes(secoes) {
  return secoes.map((secao) => ({
    titulo: secao.titulo,
    itens: secao.itens.map((item) =>
      ehPergunta(item) ? item : { ...item, preencher: item.preencher ?? false },
    ),
  }));
}

/**
 * @param {Rascunho} rascunho
 * @param {Pick<VersaoLinha, 'secoes' | 'introducao' | 'termo' | 'alertas'> | undefined} versao
 */
export function temAlteracoesNaoPublicadas(rascunho, versao) {
  if (!versao) return true;
  const atual = {
    ...rascunho,
    secoes: comPadroes(rascunho.secoes),
    alertas: rascunho.alertas ?? [],
  };
  const publicado = {
    secoes: comPadroes(/** @type {Secao[]} */ (versao.secoes)),
    introducao: versao.introducao,
    termo: versao.termo,
    alertas: versao.alertas ?? [],
  };
  return canonico(atual) !== canonico(publicado);
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

const naoEncontrado = () => erroNaoEncontrado('Formulário não encontrado');

/** @param {string} tenantId */
async function elegiveisDoTenant(tenantId) {
  const { campos } = await obterSchemaCampos(tenantId);
  return camposElegiveis(campos);
}

/**
 * @param {string} tenantId
 * @returns {Promise<CampoElegivel[]>}
 */
export function listarCamposElegiveis(tenantId) {
  return elegiveisDoTenant(tenantId);
}

/**
 * @param {FormularioLinha} linha
 * @param {VersaoLinha | undefined} versaoAtual
 */
function paraApi(linha, versaoAtual) {
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    ativo: linha.ativo,
    validadeDias: linha.validade_dias,
    versaoAtual: versaoAtual
      ? { id: versaoAtual.id, versao: versaoAtual.versao, publicadaEm: versaoAtual.publicada_em }
      : null,
    alteracoesNaoPublicadas: temAlteracoesNaoPublicadas(linha.rascunho, versaoAtual),
    atualizadoEm: linha.atualizado_em,
  };
}

/** @param {string} tenantId @param {FormularioLinha} linha */
async function comVersaoAtual(tenantId, linha) {
  const versao = linha.versao_atual_id
    ? await buscarVersao(tenantId, linha.id, linha.versao_atual_id)
    : undefined;
  return paraApi(linha, versao);
}

/** @param {string} tenantId */
export async function listarFormularios(tenantId) {
  const linhas = await buscarFormularios(tenantId);
  return Promise.all(linhas.map((linha) => comVersaoAtual(tenantId, linha)));
}

/**
 * Detalhe para a tela de montar: o rascunho, as versões e os campos
 * elegíveis, numa chamada.
 *
 * @param {string} tenantId
 * @param {string} id
 */
export async function obterFormulario(tenantId, id) {
  const linha = await buscarFormulario(tenantId, id);
  if (!linha) throw naoEncontrado();
  const [resumo, versoes] = await Promise.all([
    comVersaoAtual(tenantId, linha),
    buscarVersoes(tenantId, id),
  ]);
  return {
    ...resumo,
    rascunho: {
      ...linha.rascunho,
      secoes: comPadroes(linha.rascunho.secoes),
      alertas: linha.rascunho.alertas ?? [],
    },
    versoes: versoes.map((versao) => ({
      id: versao.id,
      versao: versao.versao,
      publicadaEm: versao.publicada_em,
      publicadaPor: versao.publicada_por,
    })),
  };
}

/** @param {string} tenantId @param {string} nome @param {string | null} ignorarId */
async function garantirNomeLivre(tenantId, nome, ignorarId) {
  if (await nomeEmUso(tenantId, nome, ignorarId)) {
    throw erroDeConflito('nome', `Já existe um formulário chamado "${nome}"`);
  }
}

/**
 * @param {string} tenantId
 * @param {{ nome: string, descricao?: string | null, validadeDias?: number }} dados
 */
export async function criarFormulario(tenantId, dados) {
  if ((await contarFormularios(tenantId)) >= LIMITES_FORMULARIO.POR_TENANT) {
    throw erroDeValidacao(
      'nome',
      `No máximo ${LIMITES_FORMULARIO.POR_TENANT} formulários por empresa`,
    );
  }
  await garantirNomeLivre(tenantId, dados.nome, null);
  const linha = await inserirFormulario(tenantId, {
    nome: dados.nome,
    descricao: dados.descricao ?? null,
    validadeDias: dados.validadeDias ?? LIMITES_FORMULARIO.VALIDADE_PADRAO_DIAS,
  });
  return obterFormulario(tenantId, linha.id);
}

/**
 * Edita dados e rascunho. O rascunho só aceita campos elegíveis agora; a
 * versão publicada não muda.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ nome?: string, descricao?: string | null, validadeDias?: number, ativo?: boolean, rascunho?: object }} mudancas
 */
export async function editarFormulario(tenantId, id, mudancas) {
  const atual = await buscarFormulario(tenantId, id);
  if (!atual) throw naoEncontrado();
  if (mudancas.nome !== undefined) await garantirNomeLivre(tenantId, mudancas.nome, id);
  const rascunho =
    mudancas.rascunho === undefined
      ? undefined
      : validarRascunho(mudancas.rascunho, await elegiveisDoTenant(tenantId));
  await atualizarFormulario(tenantId, id, { ...mudancas, rascunho });
  return obterFormulario(tenantId, id);
}

/**
 * Publica o rascunho como versão nova, se os campos ainda forem elegíveis.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {string | null} usuarioId
 */
export async function publicarFormulario(tenantId, id, usuarioId) {
  const atual = await buscarFormulario(tenantId, id);
  if (!atual) throw naoEncontrado();
  const elegiveis = await elegiveisDoTenant(tenantId);
  const rascunho = validarRascunho(atual.rascunho, elegiveis, { publicar: true });
  const versao = await inserirVersao(tenantId, id, {
    secoes: rascunho.secoes,
    campos: retratoDosCampos(rascunho, elegiveis),
    introducao: rascunho.introducao,
    termo: /** @type {string} */ (rascunho.termo),
    alertas: rascunho.alertas,
    usuarioId,
  });
  if (!versao) throw naoEncontrado();
  return versaoParaApi(versao);
}

/** @param {VersaoLinha} versao */
function versaoParaApi(versao) {
  return {
    id: versao.id,
    versao: versao.versao,
    publicadaEm: versao.publicada_em,
    publicadaPor: versao.publicada_por,
    introducao: versao.introducao,
    termo: versao.termo,
    alertas: versao.alertas ?? [],
    secoes: comPadroes(/** @type {Secao[]} */ (versao.secoes)).map((secao) => ({
      titulo: secao.titulo,
      itens: secao.itens.map((item) =>
        ehPergunta(item)
          ? item
          : { ...item, campo: versao.campos[/** @type {ItemCampo} */ (item).campoId] },
      ),
    })),
  };
}

/**
 * Uma versão publicada, como o link a mostra.
 *
 * @param {string} tenantId
 * @param {string} formId
 * @param {string} versaoId
 */
export async function obterVersao(tenantId, formId, versaoId) {
  const versao = await buscarVersao(tenantId, formId, versaoId);
  if (!versao) throw erroNaoEncontrado('Versão não encontrada');
  return versaoParaApi(versao);
}
