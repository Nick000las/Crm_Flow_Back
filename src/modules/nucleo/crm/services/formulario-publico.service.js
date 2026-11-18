/**
 * @file SERVICE: página pública do formulário (FM3), sem login.
 */
import { erroNaoEncontrado } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { moduloAtivo } from '#core/tenant/module-access.js';

import {
  buscarLinkPublico,
  marcarLinkAberto,
  tenantDoToken,
} from '../adapters/crm-form-public.repository.js';
import {
  CAMADA,
  CAMADA_2_CAMPOS,
  CRM_FEATURES,
  FORMATO_TOKEN_LINK,
  MODULO_CRM,
  STATUS_LINK,
} from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { camposElegiveis, comPadroes, ehPergunta } from './formularios.service.js';
import { hashDoToken } from './token-formulario.service.js';

/**
 * SERVICE: página pública do formulário (FM3), sem login.
 *
 * Qualquer motivo para não abrir (token que não existe, vencido, revogado,
 * respondido, formulário desativado, pessoa fora, módulo ou flag desligados)
 * dá a **mesma** resposta: quem tenta adivinhar não aprende nada.
 *
 * Campo marcado para vir preenchido traz o valor salvo da pessoa, lido agora,
 * e só se o campo continuar elegível e não for sensível neste momento: ele
 * pode ter virado sensível depois da publicação.
 *
 * @typedef {import('../adapters/crm-form-public.repository.js').LinkPublico} LinkPublico
 */

export const indisponivel = () => erroNaoEncontrado('Este link não está mais disponível');

/**
 * @param {LinkPublico | undefined} link
 * @returns {boolean}
 */
function podeAbrir(link) {
  if (!link) {
    return false;
  }

  const pessoa = link.pessoa;

  return (
    link.status === STATUS_LINK.ATIVO &&
    link.no_prazo &&
    link.formulario_ativo &&
    Boolean(pessoa) &&
    !pessoa?.anonimizado_em &&
    !pessoa?.archived_at
  );
}

/**
 * O link que o token abre, ou erro 404 genérico.
 *
 * @param {unknown} token
 * @returns {Promise<{ tenantId: string, link: LinkPublico }>}
 */
export async function resolverLink(token) {
  if (typeof token !== 'string' || !FORMATO_TOKEN_LINK.test(token)) {
    throw indisponivel();
  }

  const hash = hashDoToken(token);
  const tenantId = await tenantDoToken(hash);

  if (!tenantId) {
    throw indisponivel();
  }

  const [contratado, ligado] = await Promise.all([
    moduloAtivo(tenantId, MODULO_CRM),
    featureAtiva(tenantId, CRM_FEATURES.FORMULARIOS),
  ]);

  if (!contratado || !ligado) {
    throw indisponivel();
  }

  const link = await buscarLinkPublico(tenantId, hash);

  if (!podeAbrir(link)) {
    throw indisponivel();
  }

  return { tenantId, link: /** @type {LinkPublico} */ (link) };
}

/**
 * Valor salvo da pessoa num campo, com os nomes de coluna do lead. O
 * personalizado é gravado em `custom_fields` pelo **id** do campo.
 *
 * @param {Record<string, any>} pessoa  linha de `modulo_crm.leads`
 * @param {{ id: string, chave: string, camada: number }} campo
 * @returns {unknown}
 */
export function valorDaPessoa(pessoa, campo) {
  const valor =
    campo.camada === CAMADA.CAMADA_3
      ? pessoa.custom_fields?.[campo.id]
      : pessoa[CAMADA_2_CAMPOS[campo.chave] ?? campo.chave];

  return valor === undefined || valor === '' ? null : valor;
}

/**
 * A versão como a página mostra: sem política, chave interna nem marca de
 * sensível, e com `valor` só nos campos que podem vir preenchidos.
 *
 * @param {LinkPublico} link
 * @param {Map<string, { id: string, chave: string, camada: number, podePreencher: boolean }>} elegiveisAgora
 */
export function versaoPublica(link, elegiveisAgora) {
  const pessoa = /** @type {Record<string, any>} */ (link.pessoa);

  return {
    introducao: link.introducao,
    termo: link.termo,
    secoes: comPadroes(/** @type {any[]} */ (link.secoes)).map((secao) => ({
      titulo: secao.titulo,
      itens: secao.itens.map((item) => {
        if (ehPergunta(item)) {
          const { id, rotulo, ajuda, tipo, opcoes } = /** @type {any} */ (item).pergunta;

          return {
            pergunta: { id, rotulo, ajuda, tipo, opcoes },
            obrigatorio: item.obrigatorio,
          };
        }

        const { campoId, obrigatorio, preencher } = /** @type {any} */ (item);
        const retrato = /** @type {any} */ (link.campos[campoId] ?? {});
        const atual = elegiveisAgora.get(campoId);
        const valor = preencher && atual?.podePreencher ? valorDaPessoa(pessoa, atual) : null;

        return {
          campoId,
          obrigatorio,
          campo: {
            label: retrato.label,
            tipo: retrato.tipo,
            opcoes: retrato.opcoes ?? null,
            ...(retrato.opcoesLista ? { opcoesLista: retrato.opcoesLista } : {}),
          },
          valor,
        };
      }),
    })),
  };
}

/**
 * `GET /public/f/:token`. Não muda nada no link.
 *
 * @param {unknown} token
 */
export async function abrirFormularioPublico(token) {
  const { tenantId, link } = await resolverLink(token);
  const { campos } = await obterSchemaCampos(tenantId);
  const elegiveisAgora = new Map(camposElegiveis(campos).map((campo) => [campo.id, campo]));

  return {
    linkId: link.id,
    resposta: {
      formulario: { nome: link.formulario_nome },
      pessoa: { primeiroNome: link.pessoa?.primeiro_nome ?? null },
      expiraEm: link.expira_em,
      versao: versaoPublica(link, elegiveisAgora),
    },
  };
}

/**
 * `POST /public/f/:token/aberto`: a página chama ao exibir o formulário. Só
 * a primeira vez conta; a prévia do WhatsApp, que só faz `GET`, não marca.
 *
 * @param {unknown} token
 * @returns {Promise<string>} id do link, para o log
 */
export async function marcarFormularioAberto(token) {
  const { tenantId, link } = await resolverLink(token);

  if (!(await marcarLinkAberto(tenantId, link.id))) {
    throw indisponivel();
  }

  return link.id;
}
