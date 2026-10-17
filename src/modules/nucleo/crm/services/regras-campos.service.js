import { CAMADA, CATEGORIA_NA_FRASE, TIPOS_CAMPO, TIPOS_REGRA } from '../constants.js';
import { somenteDigitos, valorAusente } from './tipos-campo.service.js';

/**
 * SERVICE (puro): regras de obrigatoriedade por status e condicionais (M8).
 * Sem banco e sem I/O — o front tem a MESMA função pra interface (campo
 * aparece/some, asterisco de obrigatório), e os dois lados rodam os casos
 * de `testing/regras.casos.json`. A validação que vale é a do back.
 *
 * O lead é avaliado no formato da API: Camadas 1/2 pela `chave`
 * (`motivoPerda`), personalizado em `customFields[chave]`.
 *
 * @typedef {{ id: string, chave: string, label: string, tipo: string, camada: number }} CampoDaRegra
 * @typedef {{
 *   id: string,
 *   kind: 'required_from_status' | 'conditional',
 *   ativo: boolean,
 *   sistema: boolean,
 *   alvo: CampoDaRegra,
 *   condicao: { status?: string[], categorias?: string[] }
 *     | { campo: CampoDaRegra, operador: string, valor?: unknown },
 *   efeito: { obrigatorio?: boolean, visivel?: boolean },
 * }} Regra  regra resolvida contra o schema do tenant (`resolverRegras`)
 */

/** Primeiros 10 caracteres de uma data ISO: `AAAA-MM-DD`. */
const TAMANHO_DIA = 10;

/** @param {unknown} valor */
const textoNormalizado = (valor) => String(valor).trim().toLowerCase();

/** @param {unknown} valor */
const diaDe = (valor) => (valor instanceof Date ? valor.toISOString() : String(valor)).slice(0, TAMANHO_DIA);

/**
 * Valor comparável conforme o tipo do campo da condição.
 *
 * @param {string} tipo
 * @param {unknown} valor
 */
function comparavel(tipo, valor) {
  switch (tipo) {
    case TIPOS_CAMPO.NUMERO:
    case TIPOS_CAMPO.MONETARIO:
      return Number(valor);
    case TIPOS_CAMPO.DATA:
      return diaDe(valor);
    case TIPOS_CAMPO.BOOLEANO:
      return Boolean(valor);
    case TIPOS_CAMPO.TELEFONE:
      return somenteDigitos(String(valor));
    case TIPOS_CAMPO.SELECAO:
      return valor;
    default:
      return textoNormalizado(valor);
  }
}

/**
 * Mesmos operadores e mesmo sentido do filtro (`lead-filter.service.js`),
 * avaliados em memória sobre um lead.
 *
 * @param {string} tipo  tipo do campo da condição
 * @param {string} operador `igual` | `contem` | `entre` | `e_um_dos` | `vazio` | `nao_vazio`
 * @param {unknown} valorRegra
 * @param {unknown} valorLead
 * @returns {boolean}
 */
export function avaliarCondicao(tipo, operador, valorRegra, valorLead) {
  const ausente = valorAusente(valorLead);
  if (operador === 'vazio') return ausente;
  if (operador === 'nao_vazio') return !ausente;
  if (ausente) return false;

  const lista = Array.isArray(valorLead) ? valorLead : null;
  switch (operador) {
    case 'igual':
      return comparavel(tipo, valorLead) === comparavel(tipo, valorRegra);
    case 'contem':
      return lista
        ? lista.includes(valorRegra)
        : textoNormalizado(comparavel(tipo, valorLead)).includes(textoNormalizado(comparavel(tipo, valorRegra)));
    case 'e_um_dos': {
      const opcoes = (Array.isArray(valorRegra) ? valorRegra : []).map((item) => comparavel(tipo, item));
      return lista ? lista.some((item) => opcoes.includes(item)) : opcoes.includes(comparavel(tipo, valorLead));
    }
    case 'entre': {
      const { de, ate } = /** @type {{ de?: unknown, ate?: unknown }} */ (valorRegra ?? {});
      const atual = comparavel(tipo, valorLead);
      const depoisDoInicio = de === undefined || de === null || atual >= comparavel(tipo, de);
      const antesDoFim = ate === undefined || ate === null || atual <= comparavel(tipo, ate);
      return depoisDoInicio && antesDoFim;
    }
    default:
      return false;
  }
}

/**
 * @param {Record<string, any>} lead  formato da API
 * @param {CampoDaRegra} campo
 */
export function valorDoCampo(lead, campo) {
  return campo.camada === CAMADA.CAMADA_3 ? lead.customFields?.[campo.chave] : lead[campo.chave];
}

/**
 * @param {Regra} regra
 * @param {Record<string, any>} lead
 * @param {{ categoriaDoStatus?: string | null }} contexto
 */
function regraCasa(regra, lead, { categoriaDoStatus = null }) {
  if (regra.kind === TIPOS_REGRA.POR_STATUS) {
    const { status = [], categorias = [] } = /** @type {{ status?: string[], categorias?: string[] }} */ (regra.condicao);
    return (lead.status != null && status.includes(lead.status)) || (categoriaDoStatus != null && categorias.includes(categoriaDoStatus));
  }
  const { campo, operador, valor } = /** @type {{ campo: CampoDaRegra, operador: string, valor?: unknown }} */ (regra.condicao);
  return avaliarCondicao(campo.tipo, operador, valor, valorDoCampo(lead, campo));
}

/**
 * Quais campos ficam obrigatórios e quais ficam ocultos pras regras ativas,
 * dado o lead (resultante: na edição, o atual + o payload).
 *
 * - Obrigatório: alguma regra com `efeito.obrigatorio` casa.
 * - Oculto: o campo tem regra com `efeito.visivel` e nenhuma delas casa
 *   ("só aparece quando..."). Oculto nunca é obrigatório.
 *
 * @param {Regra[]} regras
 * @param {Record<string, any>} lead
 * @param {{ categoriaDoStatus?: string | null }} [contexto]  categoria do status do lead
 * @returns {{ obrigatorios: string[], ocultos: string[], motivos: Record<string, Regra> }}
 *   chaves dos campos, em ordem alfabética; `motivos`: a regra que tornou cada um obrigatório
 */
export function avaliarRegras(regras, lead, contexto = {}) {
  /** @type {Map<string, Regra>} */
  const obrigatorios = new Map();
  /** @type {Map<string, boolean>} chave → alguma regra de visibilidade casou */
  const visibilidade = new Map();

  for (const regra of regras) {
    if (!regra.ativo) continue;
    const casa = regraCasa(regra, lead, contexto);
    const { chave } = regra.alvo;
    if (regra.efeito.visivel) visibilidade.set(chave, (visibilidade.get(chave) ?? false) || casa);
    if (regra.efeito.obrigatorio && casa && !obrigatorios.has(chave)) obrigatorios.set(chave, regra);
  }

  const ocultos = [...visibilidade].filter(([, visivel]) => !visivel).map(([chave]) => chave);
  for (const chave of ocultos) obrigatorios.delete(chave);
  return {
    obrigatorios: [...obrigatorios.keys()].sort(),
    ocultos: ocultos.sort(),
    motivos: Object.fromEntries(obrigatorios),
  };
}

/**
 * Frase do "por quê" da obrigatoriedade, pra mensagem de erro.
 *
 * @param {Regra} regra
 * @param {Record<string, string>} [labelDoStatus]  key → label das opções de status
 */
export function motivoDaRegra(regra, labelDoStatus = {}) {
  if (regra.kind === TIPOS_REGRA.POR_STATUS) {
    const { status = [], categorias = [] } = /** @type {{ status?: string[], categorias?: string[] }} */ (regra.condicao);
    const partes = [
      ...status.map((key) => labelDoStatus[key] ?? key),
      ...categorias.map((categoria) => CATEGORIA_NA_FRASE[categoria] ?? categoria),
    ];
    return `quando o status é ${partes.join(' ou ')}`;
  }
  const { campo } = /** @type {{ campo: CampoDaRegra }} */ (regra.condicao);
  return `por causa do valor de "${campo.label}"`;
}

/**
 * Erros de obrigatoriedade das regras: campo obrigatório (e não oculto)
 * sem valor no lead resultante.
 *
 * @param {Regra[]} regras
 * @param {Record<string, any>} lead  formato da API
 * @param {{ categoriaDoStatus?: string | null, labelDoStatus?: Record<string, string> }} [contexto]
 * @returns {{ campo: string, mensagem: string }[]}  `campo`: chave da API (personalizado → `customFields`)
 */
export function validarRegras(regras, lead, contexto = {}) {
  const { motivos } = avaliarRegras(regras, lead, contexto);
  return Object.values(motivos)
    .filter((regra) => valorAusente(valorDoCampo(lead, regra.alvo)))
    .map((regra) => ({
      campo: regra.alvo.camada === CAMADA.CAMADA_3 ? 'customFields' : regra.alvo.chave,
      mensagem: `"${regra.alvo.label}" é obrigatório ${motivoDaRegra(regra, contexto.labelDoStatus)}`,
    }));
}

/**
 * Linhas de `crm_field_rule` → regras prontas pra avaliar, contra os campos
 * ativos do schema. Regra com alvo (ou campo da condição) fora do schema —
 * campo excluído ou desligado — some.
 *
 * @param {import('../adapters/crm-field-rules.repository.js').RegraLinha[]} linhas
 * @param {Array<{ id: string | null, chave: string, label: string, tipo: string, camada: number }>} campos
 * @returns {Regra[]}
 */
export function resolverRegras(linhas, campos) {
  const porId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));
  const resumo = ({ id, chave, label, tipo, camada }) => ({ id, chave, label, tipo, camada });

  return linhas.flatMap((linha) => {
    const alvo = porId.get(linha.field_id);
    if (!alvo) return [];
    let condicao = linha.condition;
    if (linha.kind === TIPOS_REGRA.CONDICIONAL) {
      const campo = porId.get(linha.condition.campoId);
      if (!campo) return [];
      condicao = { campo: resumo(campo), operador: linha.condition.operador, valor: linha.condition.valor };
    }
    return [
      {
        id: linha.id,
        kind: /** @type {Regra['kind']} */ (linha.kind),
        ativo: linha.is_active,
        sistema: linha.system_key !== null,
        alvo: resumo(alvo),
        condicao,
        efeito: linha.effect,
      },
    ];
  });
}
