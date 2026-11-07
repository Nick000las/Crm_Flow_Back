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
} from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';

/**
 * SERVICE: formulários (FM1, docs/crm/plano-execucao-formularios-forecast.md).
 *
 * O formulário é uma seleção de campos da pessoa que já existem no CRM, cada
 * um ligado pelo dono (decisão de 07/11/2026). O rascunho é editado à
 * vontade; publicar valida e grava uma versão imutável, com o retrato de cada
 * campo, que é o que o link e a resposta usam.
 *
 * @typedef {import('../adapters/crm-forms.repository.js').FormularioLinha} FormularioLinha
 * @typedef {import('../adapters/crm-forms.repository.js').VersaoLinha} VersaoLinha
 * @typedef {{ campoId: string, obrigatorio: boolean, politica: string }} Item
 * @typedef {{ titulo: string | null, itens: Item[] }} Secao
 * @typedef {{ secoes: Secao[], introducao: string | null, termo: string | null }} Rascunho
 * @typedef {{
 *   id: string, chave: string, label: string, tipo: string, camada: number,
 *   sensivel: boolean, opcoes: readonly string[] | null,
 *   opcoesLista?: { key: string, label: string }[], politicaPadrao: string,
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
    }));
}

/**
 * Normaliza e confere o rascunho: todo item aponta para um campo elegível,
 * sem repetir, e herda a política padrão do campo quando não vem uma.
 * Para publicar, também exige ao menos uma pergunta e o termo de aceite.
 *
 * @param {{ secoes?: { titulo?: string | null, itens?: { campoId: string, obrigatorio?: boolean, politica?: string }[] }[], introducao?: string | null, termo?: string | null }} entrada
 * @param {CampoElegivel[]} elegiveis
 * @param {{ publicar?: boolean }} [opcoes]
 * @returns {Rascunho}
 */
export function validarRascunho(entrada, elegiveis, { publicar = false } = {}) {
  const porId = new Map(elegiveis.map((campo) => [campo.id, campo]));
  /** @type {Record<string, string[]>} */
  const erros = {};
  const usados = new Set();

  const secoes = (entrada.secoes ?? []).map((secao, s) => ({
    titulo: secao.titulo?.trim() || null,
    itens: (secao.itens ?? []).map((item, i) => {
      const caminho = `rascunho.secoes.${s}.itens.${i}.campoId`;
      const campo = porId.get(item.campoId);
      if (!campo) erros[caminho] = ['Escolha um campo da pessoa que esteja ligado no CRM'];
      else if (usados.has(item.campoId))
        erros[caminho] = [`"${campo.label}" já está no formulário`];
      usados.add(item.campoId);
      return {
        campoId: item.campoId,
        obrigatorio: item.obrigatorio ?? false,
        politica: item.politica ?? campo?.politicaPadrao ?? POLITICAS_ESCRITA.SOBRESCREVER,
      };
    }),
  }));

  const termo = entrada.termo?.trim() || null;
  if (publicar && usados.size === 0) {
    erros['rascunho.secoes'] = ['Escolha ao menos um campo para publicar'];
  }
  if (publicar && !termo) {
    erros['rascunho.termo'] = ['Escreva o termo de aceite para publicar'];
  }
  if (usados.size > LIMITES_FORMULARIO.ITENS) {
    erros['rascunho.secoes'] = [`No máximo ${LIMITES_FORMULARIO.ITENS} campos por formulário`];
  }
  if (Object.keys(erros).length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: publicar ? 'O formulário não pode ser publicado assim' : 'Revise o formulário',
      fields: erros,
    });
  }
  return { secoes, introducao: entrada.introducao?.trim() || null, termo };
}

/**
 * Retrato dos campos usados, como estão agora: a versão continua legível
 * mesmo se o campo for renomeado ou desligado depois.
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
      .map(({ campoId }) => {
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
 * @param {Rascunho} rascunho
 * @param {Pick<VersaoLinha, 'secoes' | 'introducao' | 'termo'> | undefined} versao
 */
export function temAlteracoesNaoPublicadas(rascunho, versao) {
  if (!versao) return true;
  const publicado = { secoes: versao.secoes, introducao: versao.introducao, termo: versao.termo };
  return canonico(rascunho) !== canonico(publicado);
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
    rascunho: linha.rascunho,
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
    secoes: /** @type {Secao[]} */ (versao.secoes).map((secao) => ({
      titulo: secao.titulo,
      itens: secao.itens.map((item) => ({ ...item, campo: versao.campos[item.campoId] })),
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
