import { HTTP_STATUS } from '#shared/constants/index.js';
import { ENRIQUECIMENTO_CNPJ, STATUS_CNPJ } from '../constants.js';

/**
 * ADAPTER: provedor de dados de CNPJ — BrasilAPI (gratuito, sem chave).
 * Primeira chamada HTTP externa do repositório: `fetch` nativo com
 * timeout. Um provedor pago entra como outro arquivo com a mesma forma
 * (`{ nome, consultar }`); o service não sabe qual está usando.
 *
 * `consultar` devolve `{ status, dados }` no formato do CRM. Erro
 * transitório (timeout, 429, 5xx, rede) é lançado com `transitorio: true`:
 * a fila tenta de novo; quem chamou pela lupa recebe 503.
 *
 * @typedef {{
 *   razaoSocial?: string, nomeFantasia?: string, situacao?: string, cnae?: string,
 *   logradouro?: string, numero?: string, complemento?: string, bairro?: string,
 *   municipio?: string, uf?: string, cep?: string, telefone?: string, email?: string,
 *   dataAbertura?: string,
 * }} DadosReceita
 * @typedef {{ status: string, dados: DadosReceita }} ResultadoProvedor
 */

const URL_BASE = 'https://brasilapi.com.br/api/cnpj/v1';
// Sem User-Agent o firewall da BrasilAPI responde 403 (o fetch do Node não manda um).
const USER_AGENT = 'crm-flow-back/0.1';
// A BrasilAPI ainda só responde CNPJ numérico.
const SO_DIGITOS = /^\d+$/;

/** Erro que vale tentar de novo. @param {string} mensagem @param {unknown} [cause] */
function erroTransitorio(mensagem, cause) {
  return Object.assign(new Error(mensagem, { cause }), { transitorio: true });
}

/** @param {unknown} valor */
function texto(valor) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/**
 * Resposta da BrasilAPI → formato do CRM. Função pura (testada à parte).
 *
 * @param {Record<string, any>} resposta
 * @returns {DadosReceita}
 */
export function converterRespostaBrasilApi(resposta) {
  const tipoLogradouro = texto(resposta.descricao_tipo_de_logradouro);
  const logradouro = texto(resposta.logradouro);
  const cnaeCodigo = resposta.cnae_fiscal ? String(resposta.cnae_fiscal) : undefined;
  const cnaeDescricao = texto(resposta.cnae_fiscal_descricao);
  const dados = {
    razaoSocial: texto(resposta.razao_social),
    nomeFantasia: texto(resposta.nome_fantasia),
    situacao: texto(resposta.descricao_situacao_cadastral),
    cnae: [cnaeCodigo, cnaeDescricao].filter(Boolean).join(' - ') || undefined,
    // Às vezes o tipo ("RUA") vem separado, às vezes já no logradouro.
    logradouro:
      tipoLogradouro && logradouro && !logradouro.toUpperCase().startsWith(tipoLogradouro.toUpperCase())
        ? `${tipoLogradouro} ${logradouro}`
        : logradouro,
    numero: texto(resposta.numero),
    complemento: texto(resposta.complemento),
    bairro: texto(resposta.bairro),
    municipio: texto(resposta.municipio),
    uf: texto(resposta.uf),
    cep: texto(String(resposta.cep ?? '')),
    telefone: texto(resposta.ddd_telefone_1),
    email: texto(resposta.email)?.toLowerCase(),
    dataAbertura: texto(resposta.data_inicio_atividade),
  };
  return Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined));
}

export const provedorBrasilApi = Object.freeze({
  nome: 'brasilapi',

  /**
   * @param {string} cnpj  forma canônica, DV já conferido
   * @returns {Promise<ResultadoProvedor>}
   */
  async consultar(cnpj) {
    if (!SO_DIGITOS.test(cnpj)) return { status: STATUS_CNPJ.NAO_SUPORTADO, dados: {} };

    let resposta;
    try {
      // `globalThis` na hora da chamada (fetch nativo do Node ≥ 18; o teste troca por um falso).
      resposta = await globalThis.fetch(`${URL_BASE}/${cnpj}`, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: globalThis.AbortSignal.timeout(ENRIQUECIMENTO_CNPJ.TIMEOUT_PROVEDOR_MS),
      });
    } catch (erro) {
      throw erroTransitorio('BrasilAPI indisponível', erro);
    }

    if (resposta.status === HTTP_STATUS.NOT_FOUND) return { status: STATUS_CNPJ.NAO_ENCONTRADO, dados: {} };
    if (resposta.status === HTTP_STATUS.TOO_MANY_REQUESTS || resposta.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      throw erroTransitorio(`BrasilAPI respondeu ${resposta.status}`);
    }
    if (!resposta.ok) throw new Error(`BrasilAPI recusou a consulta (${resposta.status})`);

    return { status: STATUS_CNPJ.OK, dados: converterRespostaBrasilApi(await resposta.json()) };
  },
});
