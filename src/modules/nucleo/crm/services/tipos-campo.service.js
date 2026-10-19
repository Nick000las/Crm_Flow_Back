import { BRAZIL_DOCUMENTS, BRAZIL_PHONE } from '#shared/constants/index.js';
import { cnpjValido, cpfValido, emailSchema, uuidSchema } from '#shared/validators/index.js';
import { PARTES_ENDERECO, TAMANHO_UF, TIPOS_CAMPO, TIPOS_LISTA } from '../constants.js';

/**
 * Regras por tipo de campo (docs/crm/plano-configuracoes.md, M2.3) —
 * funções puras, uma fonte só pro formulário/PUT (`leads.service.js`), a
 * planilha (`import.service.js`) e o filtro (`lead-filter.service.js`),
 * pra personalizados e pros nativos do mesmo tipo (e-mail, telefone). Tipo
 * novo entra aqui (validar, normalizar, converter célula, texto de busca)
 * e em `OPERADORES_POR_TIPO` (constants.js), nunca como `switch` espalhado.
 *
 * Formato gravado em `custom_fields`:
 * - `texto`/`texto_longo`/`url`: string; `email`: string minúscula;
 * - `telefone`: só dígitos, sem DDI 55 (10 ou 11 dígitos);
 * - `numero`/`monetario`: number (`monetario` em reais, até 2 casas);
 * - `data`: string ISO; `booleano`: boolean;
 * - `selecao`: uma das opções; `selecao_multipla`: lista de opções;
 * - M11: `cpf`/`cep`: só dígitos (11/8); `cnpj`: 14 caracteres [0-9A-Z]
 *   (inclui o alfanumérico); `hora`: `HH:MM`; `usuario`: uuid de usuário
 *   ativo (o "é ativo" é conferido no service, que tem acesso a dado);
 *   `intervalo_datas`: `{ de, ate }` (`AAAA-MM-DD`, de ≤ ate);
 *   `endereco`: objeto com as partes de `PARTES_ENDERECO`, nessa ordem, só
 *   as preenchidas.
 */

export const LIMITE_TEXTO_LONGO = 10_000;
const CASAS_DECIMAIS_MONETARIO = 2;
const BASE_DECIMAL = 10;
const FATOR_CENTAVOS = BASE_DECIMAL ** CASAS_DECIMAIS_MONETARIO;
const DDI_BRASIL = '55';
const PROTOCOLOS_URL = new Set(['http:', 'https:']);
const PADRAO_DATA_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const VALORES_VERDADEIROS = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes']);
const VALORES_FALSOS = new Set(['não', 'nao', 'n', 'false', 'falso', '0', 'no']);
const PADRAO_HORA = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const PADRAO_DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const TAMANHO_DIA_ISO = 10;
const HORAS_NO_DIA = 24;
const MINUTOS_NA_HORA = 60;
const MINUTOS_NO_DIA = HORAS_NO_DIA * MINUTOS_NA_HORA;
const DIGITOS_HORA = 2;
const DATAS_NO_INTERVALO = 2;
// "01/02/2026 - 10/02/2026", "01/02/2026 a 10/02/2026", "… até …".
const SEPARADOR_INTERVALO = /\s+(?:-|–|a|até)\s+/i;
const PADRAO_UF = new RegExp(`^[A-Z]{${TAMANHO_UF}}$`);

/** @param {string} texto */
export function somenteDigitos(texto) {
  return texto.replace(/\D/g, '');
}

/**
 * Vazio pra fins de obrigatoriedade: ausente, `null`, texto vazio ou lista
 * vazia.
 *
 * @param {unknown} valor
 */
export function valorAusente(valor) {
  if (valor === undefined || valor === null || valor === '') return true;
  if (Array.isArray(valor)) return valor.length === 0;
  // Endereço / intervalo (M11): objeto sem nenhuma parte preenchida.
  if (objetoSimples(valor)) return Object.values(/** @type {object} */ (valor)).every(valorAusente);
  return false;
}

/** @param {unknown} valor */
function objetoSimples(valor) {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) && !(valor instanceof Date);
}

/** @param {number} numero */
function doisDigitos(numero) {
  return String(numero).padStart(DIGITOS_HORA, '0');
}

/** @param {string} texto @returns {string | null} */
export function normalizarCpf(texto) {
  const digitos = somenteDigitos(texto);
  return cpfValido(digitos) ? digitos : null;
}

/** @param {string} texto @returns {string | null} */
export function normalizarCnpj(texto) {
  const chave = chaveDocumento(texto);
  return chave && cnpjValido(chave) ? chave : null;
}

/** @param {string} texto @returns {string | null} */
export function normalizarCep(texto) {
  const digitos = somenteDigitos(texto);
  return digitos.length === BRAZIL_DOCUMENTS.CEP_LENGTH ? digitos : null;
}

/** `9:05`, `09:05` ou `09:05:30` → `09:05`. @param {string} texto @returns {string | null} */
export function normalizarHora(texto) {
  const partes = PADRAO_HORA.exec(texto.trim());
  if (!partes) return null;
  const [horas, minutos] = [Number(partes[1]), Number(partes[2])];
  if (horas >= HORAS_NO_DIA || minutos >= MINUTOS_NA_HORA) return null;
  return `${doisDigitos(horas)}:${partes[2]}`;
}

/** @param {unknown} valor */
function diaIsoValido(valor) {
  return (
    typeof valor === 'string' && PADRAO_DIA_ISO.test(valor.slice(0, TAMANHO_DIA_ISO)) && !Number.isNaN(Date.parse(valor))
  );
}

/** @param {unknown} valor */
function intervaloValido(valor) {
  if (!objetoSimples(valor)) return false;
  const { de, ate, ...resto } = /** @type {Record<string, unknown>} */ (valor);
  if (Object.keys(resto).length > 0 || !diaIsoValido(de) || !diaIsoValido(ate)) return false;
  return String(de).slice(0, TAMANHO_DIA_ISO) <= String(ate).slice(0, TAMANHO_DIA_ISO);
}

/** @param {unknown} valor */
function enderecoValido(valor) {
  if (!objetoSimples(valor)) return false;
  return Object.entries(/** @type {Record<string, unknown>} */ (valor)).every(([parte, conteudo]) => {
    if (!PARTES_ENDERECO.includes(parte)) return false;
    if (conteudo === null || conteudo === undefined || conteudo === '') return true;
    if (typeof conteudo !== 'string') return false;
    if (parte === 'cep') return normalizarCep(conteudo) !== null;
    if (parte === 'uf') return PADRAO_UF.test(conteudo.trim().toUpperCase());
    return true;
  });
}

/** Partes preenchidas, na ordem de `PARTES_ENDERECO`. @param {Record<string, unknown>} endereco */
function normalizarEndereco(endereco) {
  /** @type {Record<string, string>} */
  const normalizado = {};
  for (const parte of PARTES_ENDERECO) {
    const conteudo = typeof endereco[parte] === 'string' ? endereco[parte].trim() : '';
    if (!conteudo) continue;
    if (parte === 'cep') normalizado.cep = normalizarCep(conteudo) ?? conteudo;
    else if (parte === 'uf') normalizado.uf = conteudo.toUpperCase();
    else normalizado[parte] = conteudo;
  }
  return normalizado;
}

/**
 * Texto de filtro na mesma forma em que o valor é gravado — pra
 * "(11) 99999-0000" achar o que foi salvo como "11999990000". Diferente de
 * `normalizarValorDoTipo`, aceita pedaço de valor (busca parcial).
 *
 * @param {string} tipo
 * @param {string} texto
 */
export function textoDeBusca(tipo, texto) {
  if (tipo === TIPOS_CAMPO.TELEFONE || tipo === TIPOS_CAMPO.CPF || tipo === TIPOS_CAMPO.CEP) {
    return somenteDigitos(texto) || texto;
  }
  if (tipo === TIPOS_CAMPO.CNPJ) return chaveDocumento(texto) ?? texto;
  if (tipo === TIPOS_CAMPO.HORA) return normalizarHora(texto) ?? texto;
  if (tipo === TIPOS_CAMPO.USUARIO) return texto.toLowerCase();
  if (tipo === TIPOS_CAMPO.EMAIL) return texto.trim().toLowerCase();
  return texto;
}

/**
 * Telefone BR em dígitos (DDD + número), aceitando máscara e DDI 55.
 *
 * @param {string} texto
 * @returns {string | null} `null` se não for um telefone BR válido
 */
export function normalizarTelefone(texto) {
  let digitos = somenteDigitos(texto);
  if (digitos.length > BRAZIL_PHONE.MOBILE_LENGTH && digitos.startsWith(DDI_BRASIL)) {
    digitos = digitos.slice(DDI_BRASIL.length);
  }
  const valido = digitos.length >= BRAZIL_PHONE.LANDLINE_LENGTH && digitos.length <= BRAZIL_PHONE.MOBILE_LENGTH;
  return valido ? digitos : null;
}

/**
 * Chaves de duplicidade (M7) — espelho em JS das funções SQL
 * `modulo_crm.chave_telefone`/`chave_documento` e da coluna `dedup_email`
 * (migration 0020). Mudar um lado sem o outro quebra a comparação.
 */
// Fixo ou celular com o 55 na frente.
const TAMANHOS_COM_DDI = new Set([
  BRAZIL_PHONE.LANDLINE_LENGTH + DDI_BRASIL.length,
  BRAZIL_PHONE.MOBILE_LENGTH + DDI_BRASIL.length,
]);
const INDICE_NONO_DIGITO = BRAZIL_PHONE.AREA_CODE_LENGTH;
const NONO_DIGITO = '9';

/** @param {unknown} valor */
export function chaveEmail(valor) {
  return typeof valor === 'string' ? valor.trim().toLowerCase() || null : null;
}

/**
 * Só dígitos, sem DDI 55 e sem o 9 depois do DDD: "(11) 98765-4321",
 * "+55 11 98765-4321" e o antigo "11 8765-4321" dão a mesma chave.
 *
 * @param {unknown} valor
 */
export function chaveTelefone(valor) {
  if (typeof valor !== 'string') return null;
  let digitos = somenteDigitos(valor);
  if (TAMANHOS_COM_DDI.has(digitos.length) && digitos.startsWith(DDI_BRASIL)) digitos = digitos.slice(DDI_BRASIL.length);
  if (digitos.length === BRAZIL_PHONE.MOBILE_LENGTH && digitos[INDICE_NONO_DIGITO] === NONO_DIGITO) {
    digitos = digitos.slice(0, INDICE_NONO_DIGITO) + digitos.slice(INDICE_NONO_DIGITO + 1);
  }
  return digitos || null;
}

/**
 * CNPJ (inclusive o alfanumérico) e CPF: maiúsculas, só [0-9A-Z].
 *
 * @param {unknown} valor
 */
export function chaveDocumento(valor) {
  return typeof valor === 'string' ? valor.replace(/[^0-9A-Za-z]/g, '').toUpperCase() || null : null;
}

/** @param {string} texto */
function urlValida(texto) {
  try {
    const url = new URL(texto);
    return PROTOCOLOS_URL.has(url.protocol) && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Folga pro erro de ponto flutuante (`10.1 * 100` = `1010.0000000000001`). */
const TOLERANCIA_CENTAVOS = 1e-6;

/** @param {number} valor */
function temNoMaximoDuasCasas(valor) {
  const centavos = valor * FATOR_CENTAVOS;
  return Math.abs(centavos - Math.round(centavos)) < TOLERANCIA_CENTAVOS;
}

/**
 * Valor já no formato de API/JSON (não vazio — obrigatoriedade é checada
 * à parte) é aceitável pro tipo?
 *
 * @param {string} tipo
 * @param {unknown} valor
 * @param {readonly string[] | null | undefined} opcoes
 */
export function valorValidoParaTipo(tipo, valor, opcoes) {
  switch (tipo) {
    case TIPOS_CAMPO.TEXTO:
      return typeof valor === 'string';
    case TIPOS_CAMPO.TEXTO_LONGO:
      return typeof valor === 'string' && valor.length <= LIMITE_TEXTO_LONGO;
    case TIPOS_CAMPO.NUMERO:
      return typeof valor === 'number' && Number.isFinite(valor);
    case TIPOS_CAMPO.MONETARIO:
      return typeof valor === 'number' && Number.isFinite(valor) && temNoMaximoDuasCasas(valor);
    case TIPOS_CAMPO.DATA:
      return typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
    case TIPOS_CAMPO.BOOLEANO:
      return typeof valor === 'boolean';
    case TIPOS_CAMPO.SELECAO:
      return Boolean(opcoes?.includes(/** @type {string} */ (valor)));
    case TIPOS_CAMPO.SELECAO_MULTIPLA:
      return Array.isArray(valor) && valor.every((item) => opcoes?.includes(item));
    case TIPOS_CAMPO.TELEFONE:
      return typeof valor === 'string' && normalizarTelefone(valor) !== null;
    case TIPOS_CAMPO.EMAIL:
      return typeof valor === 'string' && emailSchema.safeParse(valor.trim()).success;
    case TIPOS_CAMPO.URL:
      return typeof valor === 'string' && urlValida(valor.trim());
    case TIPOS_CAMPO.CPF:
      return typeof valor === 'string' && normalizarCpf(valor) !== null;
    case TIPOS_CAMPO.CNPJ:
      return typeof valor === 'string' && normalizarCnpj(valor) !== null;
    case TIPOS_CAMPO.CEP:
      return typeof valor === 'string' && normalizarCep(valor) !== null;
    case TIPOS_CAMPO.HORA:
      return typeof valor === 'string' && normalizarHora(valor) !== null;
    case TIPOS_CAMPO.USUARIO:
      return uuidSchema.safeParse(valor).success;
    case TIPOS_CAMPO.INTERVALO_DATAS:
      return intervaloValido(valor);
    case TIPOS_CAMPO.ENDERECO:
      return enderecoValido(valor);
    default:
      return false;
  }
}

/**
 * Forma canônica de gravação (só depois de `valorValidoParaTipo`). Tipo
 * sem normalização devolve o valor como veio.
 *
 * @param {string} tipo
 * @param {unknown} valor
 */
export function normalizarValorDoTipo(tipo, valor) {
  if (objetoSimples(valor)) {
    const objeto = /** @type {Record<string, unknown>} */ (valor);
    if (tipo === TIPOS_CAMPO.ENDERECO) return normalizarEndereco(objeto);
    if (tipo === TIPOS_CAMPO.INTERVALO_DATAS) {
      return { de: String(objeto.de).slice(0, TAMANHO_DIA_ISO), ate: String(objeto.ate).slice(0, TAMANHO_DIA_ISO) };
    }
    return valor;
  }
  if (typeof valor !== 'string') return valor;
  switch (tipo) {
    case TIPOS_CAMPO.CPF:
      return normalizarCpf(valor) ?? valor;
    case TIPOS_CAMPO.CNPJ:
      return normalizarCnpj(valor) ?? valor;
    case TIPOS_CAMPO.CEP:
      return normalizarCep(valor) ?? valor;
    case TIPOS_CAMPO.HORA:
      return normalizarHora(valor) ?? valor;
    case TIPOS_CAMPO.USUARIO:
      return valor.toLowerCase();
    case TIPOS_CAMPO.TELEFONE:
      return normalizarTelefone(valor) ?? valor;
    case TIPOS_CAMPO.EMAIL:
      return valor.trim().toLowerCase();
    case TIPOS_CAMPO.URL:
      return valor.trim();
    default:
      return valor;
  }
}

/**
 * Célula de planilha → valor no formato gravado, pra qualquer tipo (o
 * import só decide pra onde o valor vai). Erro vira mensagem pro
 * relatório, nunca exceção — o relatório junta todas as linhas.
 *
 * @param {{ tipo: string, label: string, opcoes?: readonly string[] | null, usuarios?: Map<string, string> }} campo
 *   `usuarios` (tipo `usuario`): nome em minúsculas → id dos usuários ativos
 * @param {string | number | boolean | Date} bruto  nunca `null` aqui
 * @returns {{ valor: unknown } | { erro: string }}
 */
export function converterCelula(campo, bruto) {
  const texto = bruto instanceof Date ? bruto.toISOString() : String(bruto).trim();

  switch (campo.tipo) {
    case TIPOS_CAMPO.TEXTO:
      return { valor: texto };
    case TIPOS_CAMPO.NUMERO: {
      const numero = typeof bruto === 'number' ? bruto : converterNumero(texto);
      return Number.isFinite(numero) ? { valor: numero } : { erro: `"${campo.label}" espera um número` };
    }
    case TIPOS_CAMPO.DATA: {
      const data = bruto instanceof Date ? bruto : converterData(texto);
      return data && !Number.isNaN(data.getTime())
        ? { valor: data.toISOString() }
        : { erro: `"${campo.label}" espera uma data (dd/mm/aaaa)` };
    }
    case TIPOS_CAMPO.BOOLEANO: {
      const normalizado = String(bruto).trim().toLowerCase();
      if (bruto === true || VALORES_VERDADEIROS.has(normalizado)) return { valor: true };
      if (bruto === false || VALORES_FALSOS.has(normalizado)) return { valor: false };
      return { erro: `"${campo.label}" espera sim ou não` };
    }
    case TIPOS_CAMPO.SELECAO: {
      const opcao = casarOpcao(campo, texto);
      return opcao !== undefined ? { valor: opcao } : { erro: `"${texto}" não é uma opção de "${campo.label}"` };
    }
    case TIPOS_CAMPO.SELECAO_MULTIPLA: {
      const itens = texto.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
      const valores = itens.map((item) => casarOpcao(campo, item));
      const invalido = itens.find((_, i) => valores[i] === undefined);
      return invalido === undefined
        ? { valor: valores }
        : { erro: `"${invalido}" não é uma opção de "${campo.label}"` };
    }
    case TIPOS_CAMPO.TEXTO_LONGO:
      return texto.length <= LIMITE_TEXTO_LONGO
        ? { valor: texto }
        : { erro: `"${campo.label}" passa de ${LIMITE_TEXTO_LONGO} caracteres` };
    case TIPOS_CAMPO.MONETARIO: {
      const numero = typeof bruto === 'number' ? bruto : converterNumero(texto.replace(/^R\$\s*/i, ''));
      return Number.isFinite(numero)
        ? { valor: Math.round(numero * FATOR_CENTAVOS) / FATOR_CENTAVOS }
        : { erro: `"${campo.label}" espera um valor em reais` };
    }
    case TIPOS_CAMPO.TELEFONE: {
      const telefone = normalizarTelefone(texto);
      return telefone ? { valor: telefone } : { erro: `Telefone inválido em "${campo.label}": "${texto}"` };
    }
    case TIPOS_CAMPO.EMAIL:
      return emailSchema.safeParse(texto).success
        ? { valor: texto.toLowerCase() }
        : { erro: `E-mail inválido em "${campo.label}": "${texto}"` };
    case TIPOS_CAMPO.URL:
      return urlValida(texto) ? { valor: texto } : { erro: `"${campo.label}" espera um link (http/https)` };
    // Documento em célula numérica perde o zero da frente (CEP 1310100).
    case TIPOS_CAMPO.CPF: {
      const cpf = normalizarCpf(comZerosAEsquerda(bruto, texto, BRAZIL_DOCUMENTS.CPF_LENGTH));
      return cpf ? { valor: cpf } : { erro: `CPF inválido em "${campo.label}": "${texto}"` };
    }
    case TIPOS_CAMPO.CNPJ: {
      const cnpj = normalizarCnpj(comZerosAEsquerda(bruto, texto, BRAZIL_DOCUMENTS.CNPJ_LENGTH));
      return cnpj ? { valor: cnpj } : { erro: `CNPJ inválido em "${campo.label}": "${texto}"` };
    }
    case TIPOS_CAMPO.CEP: {
      const cep = normalizarCep(comZerosAEsquerda(bruto, texto, BRAZIL_DOCUMENTS.CEP_LENGTH));
      return cep ? { valor: cep } : { erro: `CEP inválido em "${campo.label}": "${texto}"` };
    }
    case TIPOS_CAMPO.HORA: {
      const hora = converterHora(bruto, texto);
      return hora ? { valor: hora } : { erro: `"${campo.label}" espera uma hora (hh:mm)` };
    }
    case TIPOS_CAMPO.INTERVALO_DATAS: {
      const intervalo = converterIntervalo(bruto, texto);
      return intervalo ? { valor: intervalo } : { erro: `"${campo.label}" espera um período (dd/mm/aaaa - dd/mm/aaaa)` };
    }
    case TIPOS_CAMPO.ENDERECO:
      // Uma célula só não dá pra separar em partes: vai inteira no logradouro.
      return { valor: { logradouro: texto } };
    case TIPOS_CAMPO.USUARIO: {
      const id = campo.usuarios?.get(texto.toLowerCase());
      return id ? { valor: id } : { erro: `"${texto}" não é um usuário ativo (em "${campo.label}")` };
    }
    default:
      return { erro: `Tipo de campo "${campo.tipo}" não suportado` };
  }
}

/**
 * Casa sem diferenciar maiúscula/minúscula e devolve a opção canônica.
 * Campo de lista (M3) aceita a key ou o nome de uma opção ATIVA e devolve
 * a key; tag é livre (vira opção ao gravar). Sem `opcoes`, qualquer valor.
 *
 * @param {{ opcoes?: readonly string[] | null, lista?: string | null, opcoesLista?: { key: string, label: string, ativo: boolean }[] }} campo
 * @param {string} valor
 */
function casarOpcao(campo, valor) {
  const alvo = valor.toLowerCase();
  if (campo.lista === TIPOS_LISTA.TAG) return valor;
  if (campo.opcoesLista) {
    return campo.opcoesLista.find(
      (opcao) => opcao.ativo && (opcao.key.toLowerCase() === alvo || opcao.label.toLowerCase() === alvo),
    )?.key;
  }
  if (!campo.opcoes) return valor;
  return campo.opcoes.find((opcao) => opcao.toLowerCase() === alvo);
}

/** Aceita `1234.5`, `1234,5` e `1.234,50`. @param {string} texto */
function converterNumero(texto) {
  const limpo = texto.replace(/\s/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return normalizado.length > 0 ? Number(normalizado) : Number.NaN;
}

/**
 * @param {string | number | boolean | Date} bruto
 * @param {string} texto
 * @param {number} tamanho
 */
function comZerosAEsquerda(bruto, texto, tamanho) {
  return typeof bruto === 'number' && Number.isInteger(bruto) ? texto.padStart(tamanho, '0') : texto;
}

/**
 * Hora de planilha: `14:30`, fração do dia (o Excel guarda hora como
 * número) ou `Date` (o exceljs lê célula de hora como 30/12/1899 + hora, UTC).
 *
 * @param {string | number | boolean | Date} bruto
 * @param {string} texto
 */
function converterHora(bruto, texto) {
  if (bruto instanceof Date) return `${doisDigitos(bruto.getUTCHours())}:${doisDigitos(bruto.getUTCMinutes())}`;
  if (typeof bruto === 'number' && bruto >= 0 && bruto < 1) {
    const minutos = Math.round(bruto * MINUTOS_NO_DIA) % MINUTOS_NO_DIA;
    return `${doisDigitos(Math.floor(minutos / MINUTOS_NA_HORA))}:${doisDigitos(minutos % MINUTOS_NA_HORA)}`;
  }
  return normalizarHora(texto);
}

/**
 * Período de planilha: duas datas separadas por " - ", " a " ou " até ";
 * uma data só = um dia.
 *
 * @param {string | number | boolean | Date} bruto
 * @param {string} texto
 * @returns {{ de: string, ate: string } | null}
 */
function converterIntervalo(bruto, texto) {
  const datas = bruto instanceof Date ? [bruto] : texto.split(SEPARADOR_INTERVALO).map((parte) => converterData(parte.trim()));
  if (datas.length > DATAS_NO_INTERVALO || datas.some((data) => !data || Number.isNaN(data.getTime()))) return null;
  const [de, ate = de] = /** @type {Date[]} */ (datas).map((data) => data.toISOString().slice(0, TAMANHO_DIA_ISO));
  return de <= ate ? { de, ate } : null;
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
