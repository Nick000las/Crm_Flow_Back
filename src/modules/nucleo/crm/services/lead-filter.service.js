import { Prisma } from '@prisma/client';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  CAMADA,
  CAMADA_1_CAMPOS,
  CAMADA_2_CAMPOS,
  CAMPOS_DUPLICIDADE,
  DIAS_NA_LIXEIRA,
  IDENTIFICADORES_NUMERICOS,
  OPERADORES_POR_TIPO,
  SITUACOES_LEAD,
  TIPOS_CAMPO,
} from '../constants.js';
import { condicaoEsfriando } from '../adapters/crm-inatividade.sql.js';
import { chaveDocumento, normalizarHora, somenteDigitos, textoDeBusca } from './tipos-campo.service.js';

/** Tipos guardados como número (faixa e igualdade numérica). */
const TIPOS_NUMERICOS = new Set([TIPOS_CAMPO.NUMERO, TIPOS_CAMPO.MONETARIO]);

/**
 * SERVICE: traduz o filtro de POST /crm/leads/search em fragmentos SQL
 * parametrizados (docs/crm/plano-campos-filtros-import-export.md §2.3).
 * Função pura — não acessa banco; o adapter só junta os fragmentos.
 *
 * Regras de segurança:
 * - nome de coluna (Camadas 1/2) só sai de `CAMADA_1_CAMPOS`/`CAMADA_2_CAMPOS`
 *   (lista fechada) — o texto do cliente nunca vira identificador SQL;
 * - todo valor (inclusive a `chave` de Camada 3) entra como parâmetro;
 * - o operador decide qual fragmento gerar, nunca é interpolado.
 *
 * @typedef {{ chave: string, label: string, tipo: string, camada: number, opcoes?: readonly string[] | null, chaveArmazenamento?: string }} Campo
 *   `chaveArmazenamento`: onde o valor do personalizado mora em
 *   `custom_fields` (o `id` do campo, via `camposParaFiltro`); omitida = `chave`.
 * @typedef {{ chave: string, operador: string, valor?: unknown }} FiltroCampo
 * @typedef {{
 *   busca?: string,
 *   funilEstagioId?: string,
 *   usuarioResponsavelId?: string,
 *   semResponsavel?: boolean,
 *   valorMin?: number,
 *   valorMax?: number,
 *   criadoDe?: Date,
 *   criadoAte?: Date,
 *   situacao?: 'ativos' | 'arquivados' | 'lixeira',
 *   filtros?: FiltroCampo[],
 * }} FiltroLeads
 */

/** Primeiros 10 caracteres (`AAAA-MM-DD`) de uma data ISO guardada em JSONB. */
const TAMANHO_DATA_ISO = 10;

/** Texto só com dígitos e máscara de telefone — sem letra nenhuma. */
const PADRAO_BUSCA_TELEFONE = /^[\d\s()+.-]*\d[\d\s()+.-]*$/;

/** Telefone nativo comparado sem máscara (texto fixo, sem dado do cliente). */
const TELEFONE_SO_DIGITOS = Prisma.raw(`regexp_replace(l.telefone, '[^0-9]', '', 'g')`);

/** Milissegundos num dia — o prazo da lixeira é contado em dias corridos. */
const MS_POR_DIA = 86_400_000;

/**
 * Quem foi excluído a partir desta data ainda está na lixeira (restaurável);
 * antes dela, já passou do prazo e é purgado.
 *
 * @param {Date} [agora]
 * @returns {Date}
 */
export function inicioDaLixeira(agora = new Date()) {
  return new Date(agora.getTime() - DIAS_NA_LIXEIRA * MS_POR_DIA);
}

/**
 * Quando um lead excluído em `excluidoEm` sai da lixeira de vez.
 *
 * @param {Date} excluidoEm
 * @returns {Date}
 */
export function dataDaPurga(excluidoEm) {
  return new Date(new Date(excluidoEm).getTime() + DIAS_NA_LIXEIRA * MS_POR_DIA);
}

/**
 * Situação do lead (M5) — entra em TODA consulta montada aqui, então lead
 * na lixeira só aparece quando pedido explicitamente (e só dentro do prazo).
 * Sem a feature `crm.arquivo`, "ativos" inclui os arquivados: desligar a
 * flag (kill switch) não esconde lead nenhum.
 *
 * @param {FiltroLeads['situacao']} situacao
 * @param {{ comArquivo?: boolean, agora?: Date }} [opcoes]
 * @returns {Prisma.Sql}
 */
export function condicaoDaSituacao(situacao = SITUACOES_LEAD.ATIVOS, { comArquivo = true, agora } = {}) {
  if (situacao === SITUACOES_LEAD.LIXEIRA) {
    return Prisma.sql`l.deleted_at >= ${inicioDaLixeira(agora)}`;
  }
  if (situacao === SITUACOES_LEAD.ARQUIVADOS) {
    return Prisma.sql`l.deleted_at IS NULL AND l.archived_at IS NOT NULL`;
  }
  return comArquivo
    ? Prisma.sql`l.deleted_at IS NULL AND l.archived_at IS NULL`
    : Prisma.sql`l.deleted_at IS NULL`;
}

/**
 * @param {FiltroLeads} filtro
 * @param {Campo[]} campos campos ativos do tenant (`listarCamposDoTenant`) —
 *   Camada 2 desligada já não está aqui, então não dá pra filtrar por ela.
 * @param {{
 *   identificador?: { chave: string, camada: number, id?: string | null } | null,
 *   comArquivo?: boolean,
 *   agora?: Date,
 * }} [opcoes] `identificador`: do layout do tenant (M4), também entra na
 *   `busca`. `comArquivo`/`agora`: ver `condicaoDaSituacao`; `agora` também
 *   é o relógio do filtro `esfriando` (M9 — a flag é conferida por quem chama).
 * @returns {Prisma.Sql[]}
 */
export function montarCondicoes(filtro, campos, { identificador = null, comArquivo = true, agora } = {}) {
  const condicoes = [condicaoDaSituacao(filtro.situacao, { comArquivo, agora })];

  if (filtro.busca) {
    const padrao = `%${escaparLike(filtro.busca)}%`;
    const digitos = PADRAO_BUSCA_TELEFONE.test(filtro.busca) ? somenteDigitos(filtro.busca) : '';
    // Busca com cara de telefone ("(11) 9999") compara pelos dígitos, que é
    // como o telefone é gravado (e como os antigos, com máscara, ficam).
    const porTelefone = digitos
      ? Prisma.sql`${TELEFONE_SO_DIGITOS} LIKE ${`%${digitos}%`}`
      : Prisma.sql`l.telefone ILIKE ${padrao}`;
    const porIdentificador = condicaoBuscaIdentificador(identificador, filtro.busca, padrao);
    condicoes.push(
      porIdentificador
        ? Prisma.sql`(l.nome ILIKE ${padrao} OR l.email ILIKE ${padrao} OR ${porTelefone} OR ${porIdentificador})`
        : Prisma.sql`(l.nome ILIKE ${padrao} OR l.email ILIKE ${padrao} OR ${porTelefone})`,
    );
  }
  if (filtro.funilEstagioId) {
    condicoes.push(Prisma.sql`l.funil_estagio_id = ${filtro.funilEstagioId}::uuid`);
  }
  if (filtro.usuarioResponsavelId && filtro.semResponsavel) {
    const mensagem = 'Use "sem responsável" ou um responsável, não os dois';
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: mensagem,
      fields: { semResponsavel: [mensagem] },
    });
  }
  if (filtro.usuarioResponsavelId) {
    condicoes.push(Prisma.sql`l.usuario_responsavel_id = ${filtro.usuarioResponsavelId}::uuid`);
  }
  if (filtro.semResponsavel) {
    // Mesmo critério de `contarEsfriandoPorResponsavel`: responsável
    // desativado conta como sem responsável.
    condicoes.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = l.usuario_responsavel_id AND u.ativo)`,
    );
  }
  if (filtro.valorMin !== undefined) {
    condicoes.push(Prisma.sql`l.valor >= ${filtro.valorMin}`);
  }
  if (filtro.valorMax !== undefined) {
    condicoes.push(Prisma.sql`l.valor <= ${filtro.valorMax}`);
  }
  if (filtro.criadoDe) {
    condicoes.push(Prisma.sql`l.created_at >= ${new Date(filtro.criadoDe)}`);
  }
  if (filtro.criadoAte) {
    condicoes.push(Prisma.sql`l.created_at <= ${new Date(filtro.criadoAte)}`);
  }
  if (filtro.esfriando) {
    condicoes.push(condicaoEsfriando(agora ?? new Date()));
  }

  const campoPorChave = new Map(campos.map((campo) => [campo.chave, campo]));

  for (const item of filtro.filtros ?? []) {
    const campo = campoPorChave.get(item.chave);
    if (!campo) {
      throw erroDeFiltro(item.chave, `"${item.chave}" não é um campo ativo para filtro`);
    }
    if (!OPERADORES_POR_TIPO[campo.tipo]?.includes(item.operador)) {
      throw erroDeFiltro(item.chave, `Operador "${item.operador}" não se aplica ao campo "${campo.label}"`);
    }

    condicoes.push(
      campo.camada === CAMADA.CAMADA_3
        ? condicaoCamada3(campo, item)
        : condicaoColuna(colunaNativa(campo), campo, item),
    );
  }

  return condicoes;
}

/**
 * Busca pelo identificador do layout (M4.3). CNPJ/CPF: só os dígitos, com
 * LIKE de prefixo — a mesma expressão dos índices da migration 0017, então
 * `12.345.678/0001-90` e `12345678000190` acham o mesmo lead. Outro campo
 * de texto: ILIKE. Nome/E-mail já estão na busca (chega `null`).
 *
 * @param {{ chave: string, camada: number, id?: string | null } | null} identificador
 * @param {string} busca
 * @param {string} padrao  `%busca%` já escapado
 * @returns {Prisma.Sql | null}
 */
function condicaoBuscaIdentificador(identificador, busca, padrao) {
  if (!identificador) return null;

  if (IDENTIFICADORES_NUMERICOS.includes(identificador.chave)) {
    // Mesma chave da duplicidade (M7): sem pontuação, maiúscula — cobre o
    // CNPJ alfanumérico. Só [0-9A-Z]: não sobra curinga de LIKE pra escapar.
    const chave = chaveDocumento(busca);
    if (!chave) return null;
    const coluna = Prisma.raw(`l.${CAMPOS_DUPLICIDADE[identificador.chave].coluna}`);
    return Prisma.sql`${coluna} LIKE ${`${chave}%`}`;
  }
  if (identificador.camada === CAMADA.CAMADA_3 && identificador.id) {
    return Prisma.sql`(l.custom_fields->>${identificador.id}) ILIKE ${padrao}`;
  }
  const coluna = CAMADA_2_CAMPOS[identificador.chave];
  return coluna ? Prisma.sql`${Prisma.raw(`l.${coluna}`)} ILIKE ${padrao}` : null;
}

/**
 * Coluna nativa na mesma forma canônica do valor do filtro
 * (`textoDoTipo`): telefone sem máscara, e-mail minúsculo — vale também
 * pra linha gravada antes da normalização.
 *
 * @param {Campo} campo
 * @returns {Prisma.Sql}
 */
function colunaNativa(campo) {
  const coluna = campo.camada === CAMADA.CAMADA_1 ? CAMADA_1_CAMPOS[campo.chave] : CAMADA_2_CAMPOS[campo.chave];
  if (!coluna) {
    // `campos` sempre vem de constants.js + banco, nunca do cliente — só
    // defesa em profundidade, pra nunca cair num Prisma.raw sem mapa.
    throw erroDeFiltro(campo.chave, `"${campo.chave}" não é um campo filtrável`);
  }
  if (campo.tipo === TIPOS_CAMPO.TELEFONE || campo.tipo === TIPOS_CAMPO.CEP) {
    return Prisma.raw(`regexp_replace(l.${coluna}, '[^0-9]', '', 'g')`);
  }
  if (campo.tipo === TIPOS_CAMPO.EMAIL) return Prisma.raw(`lower(l.${coluna})`);
  // M11: CPF/CNPJ nativos pela coluna de duplicidade (M7), já sem máscara e
  // em maiúsculas — cobre as linhas antigas gravadas com pontuação.
  if (campo.tipo === TIPOS_CAMPO.CPF || campo.tipo === TIPOS_CAMPO.CNPJ) return Prisma.raw(`l.dedup_${coluna}`);
  return Prisma.raw(`l.${coluna}`);
}

/**
 * Camadas 1/2: coluna física, mesmo mecanismo pra todo tipo.
 *
 * @param {Prisma.Sql} coluna
 * @param {Campo} campo
 * @param {FiltroCampo} item
 * @returns {Prisma.Sql}
 */
function condicaoColuna(coluna, campo, { chave, operador, valor }) {
  const multipla = campo.tipo === 'selecao_multipla';

  switch (operador) {
    case 'vazio':
      return multipla
        ? Prisma.sql`COALESCE(cardinality(${coluna}), 0) = 0`
        : Prisma.sql`(${coluna} IS NULL OR ${coluna}::text = '')`;
    case 'nao_vazio':
      return multipla
        ? Prisma.sql`COALESCE(cardinality(${coluna}), 0) > 0`
        : Prisma.sql`(${coluna} IS NOT NULL AND ${coluna}::text <> '')`;
    case 'contem':
      return multipla
        ? Prisma.sql`${exigirTexto(chave, valor)} = ANY(${coluna})`
        : Prisma.sql`${coluna} ILIKE ${`%${escaparLike(textoDoTipo(campo, exigirTexto(chave, valor)))}%`}`;
    case 'e_um_dos':
      return multipla
        ? Prisma.sql`${coluna} && ${exigirListaDeTexto(chave, valor)}::varchar[]`
        : Prisma.sql`${coluna} = ANY(${exigirListaDeTexto(chave, valor).map((item) => textoDoTipo(campo, item))}::varchar[])`;
    case 'igual':
      if (campo.tipo === 'data') {
        return Prisma.sql`${coluna}::date = ${exigirData(chave, valor)}::date`;
      }
      return Prisma.sql`${coluna} = ${valorEscalar(campo, chave, valor)}`;
    case 'entre':
      return condicaoEntre(coluna, campo, chave, valor);
    default:
      throw erroDeFiltro(chave, `Operador "${operador}" inválido`);
  }
}

/**
 * Camada 3: `custom_fields` JSONB. Igualdade/seleção usam containment
 * (`@>`), que é o caso que o índice GIN acelera; texto parcial e faixa
 * numérica/data não usam o GIN (caveat registrado no plano, §2.4).
 *
 * @param {Campo} campo
 * @param {FiltroCampo} item
 * @returns {Prisma.Sql}
 */
function condicaoCamada3(campo, { chave, operador, valor }) {
  // `chave` segue sendo o que o cliente mandou (mensagens de erro);
  // `caminho` é a chave real dentro do JSONB.
  const caminho = campo.chaveArmazenamento ?? chave;
  const texto = Prisma.sql`(l.custom_fields->>${caminho})`;
  const json = Prisma.sql`(l.custom_fields->${caminho})`;

  switch (operador) {
    // Objeto vazio (endereço/intervalo, M11) conta como vazio.
    case 'vazio':
      return Prisma.sql`(COALESCE(${texto}, '') = '' OR ${json} IN ('[]'::jsonb, '{}'::jsonb))`;
    case 'nao_vazio':
      return Prisma.sql`(COALESCE(${texto}, '') <> '' AND ${json} NOT IN ('[]'::jsonb, '{}'::jsonb))`;
    case 'contem':
      if (campo.tipo === 'selecao_multipla') {
        return Prisma.sql`l.custom_fields @> ${JSON.stringify({ [caminho]: [exigirTexto(chave, valor)] })}::jsonb`;
      }
      if (campo.tipo === TIPOS_CAMPO.ENDERECO) {
        // Só os valores das partes (nunca o nome da chave, ex. "cidade").
        const partes = Prisma.sql`(SELECT string_agg(value, ' ') FROM jsonb_each_text(CASE WHEN jsonb_typeof(${json}) = 'object' THEN ${json} END))`;
        return Prisma.sql`${partes} ILIKE ${`%${escaparLike(exigirTexto(chave, valor))}%`}`;
      }
      return Prisma.sql`${texto} ILIKE ${`%${escaparLike(textoDoTipo(campo, exigirTexto(chave, valor)))}%`}`;
    case 'e_um_dos':
      if (campo.tipo === 'selecao_multipla') {
        return Prisma.sql`jsonb_exists_any(${json}, ${exigirListaDeTexto(chave, valor)}::text[])`;
      }
      return Prisma.sql`${texto} = ANY(${exigirListaDeTexto(chave, valor).map((item) => textoDoTipo(campo, item))}::text[])`;
    case 'igual':
      if (campo.tipo === 'data') {
        return Prisma.sql`${dataCamada3(texto)} = ${exigirData(chave, valor)}::date`;
      }
      return Prisma.sql`l.custom_fields @> ${JSON.stringify({ [caminho]: valorEscalar(campo, chave, valor) })}::jsonb`;
    case 'entre':
      if (campo.tipo === TIPOS_CAMPO.INTERVALO_DATAS) return condicaoSobrepoe(json, chave, valor);
      return condicaoEntre(expressaoDeFaixa(campo, json, texto), campo, chave, valor);
    default:
      throw erroDeFiltro(chave, `Operador "${operador}" inválido`);
  }
}

/**
 * @param {Campo} campo
 * @param {Prisma.Sql} json
 * @param {Prisma.Sql} texto
 */
function expressaoDeFaixa(campo, json, texto) {
  if (campo.tipo === 'data') return dataCamada3(texto);
  if (campo.tipo === TIPOS_CAMPO.HORA) return Prisma.sql`(CASE WHEN ${texto} ~ '^[0-9]{2}:[0-9]{2}$' THEN ${texto}::time END)`;
  return numeroCamada3(json, texto);
}

/**
 * Intervalo de datas (M11): `entre` = os dois períodos se sobrepõem — o
 * do lead começa até o fim do filtro e termina depois do início dele.
 *
 * @param {Prisma.Sql} json
 * @param {string} chave
 * @param {unknown} valor
 */
function condicaoSobrepoe(json, chave, valor) {
  const faixa = /** @type {{ de?: unknown, ate?: unknown }} */ (valor ?? {});
  const temDe = faixa.de !== undefined && faixa.de !== null;
  const temAte = faixa.ate !== undefined && faixa.ate !== null;
  if (typeof valor !== 'object' || (!temDe && !temAte)) {
    throw erroDeFiltro(chave, 'Informe "de" e/ou "ate" para o filtro de faixa');
  }
  const partes = [];
  if (temAte) partes.push(Prisma.sql`${dataCamada3(Prisma.sql`(${json}->>'de')`)} <= ${exigirData(chave, faixa.ate)}::date`);
  if (temDe) partes.push(Prisma.sql`${dataCamada3(Prisma.sql`(${json}->>'ate')`)} >= ${exigirData(chave, faixa.de)}::date`);
  return Prisma.sql`(${Prisma.join(partes, ' AND ')})`;
}

/**
 * Cast protegido: um valor órfão de tipo diferente (definição editada
 * depois do dado gravado) vira `NULL` em vez de derrubar a query inteira
 * com erro de conversão.
 *
 * @param {Prisma.Sql} json
 * @param {Prisma.Sql} texto
 */
function numeroCamada3(json, texto) {
  return Prisma.sql`(CASE WHEN jsonb_typeof(${json}) = 'number' THEN ${texto}::numeric END)`;
}

/** @param {Prisma.Sql} texto */
function dataCamada3(texto) {
  // `::int` explícito: o Prisma manda número JS como bigint, e não existe
  // `left(text, bigint)` no Postgres.
  return Prisma.sql`(CASE WHEN ${texto} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${texto}, ${TAMANHO_DATA_ISO}::int)::date END)`;
}

/**
 * `valor` de `entre` é `{ de?, ate? }`, ao menos um dos dois.
 *
 * @param {Prisma.Sql} expressao
 * @param {Campo} campo
 * @param {string} chave
 * @param {unknown} valor
 */
function condicaoEntre(expressao, campo, chave, valor) {
  const faixa = /** @type {{ de?: unknown, ate?: unknown }} */ (valor ?? {});
  const temDe = faixa.de !== undefined && faixa.de !== null;
  const temAte = faixa.ate !== undefined && faixa.ate !== null;

  if (typeof valor !== 'object' || (!temDe && !temAte)) {
    throw erroDeFiltro(chave, 'Informe "de" e/ou "ate" para o filtro de faixa');
  }

  const converter = conversorDeFaixa(campo, chave);
  const partes = [];
  if (temDe) partes.push(Prisma.sql`${expressao} >= ${converter(faixa.de)}`);
  if (temAte) partes.push(Prisma.sql`${expressao} <= ${converter(faixa.ate)}`);
  return Prisma.sql`(${Prisma.join(partes, ' AND ')})`;
}

/**
 * @param {Campo} campo
 * @param {string} chave
 * @returns {(valor: unknown) => unknown}
 */
function conversorDeFaixa(campo, chave) {
  if (campo.tipo === 'data') return (valor) => exigirData(chave, valor);
  if (campo.tipo === TIPOS_CAMPO.HORA) return (valor) => Prisma.sql`${exigirHora(chave, valor)}::time`;
  return (valor) => exigirNumero(chave, valor);
}

/** @param {string} chave @param {unknown} valor */
function exigirHora(chave, valor) {
  const hora = typeof valor === 'string' ? normalizarHora(valor) : null;
  if (!hora) throw erroDeFiltro(chave, 'Informe uma hora (hh:mm)');
  return hora;
}

/**
 * @param {Campo} campo
 * @param {string} chave
 * @param {unknown} valor
 */
function valorEscalar(campo, chave, valor) {
  if (TIPOS_NUMERICOS.has(campo.tipo)) return exigirNumero(chave, valor);
  if (campo.tipo === 'booleano') {
    if (typeof valor !== 'boolean') throw erroDeFiltro(chave, 'Informe verdadeiro ou falso');
    return valor;
  }
  return textoDoTipo(campo, exigirTexto(chave, valor));
}

/**
 * @param {Campo} campo
 * @param {string} texto
 */
function textoDoTipo(campo, texto) {
  return textoDeBusca(campo.tipo, texto);
}

/** @param {string} chave @param {unknown} valor */
function exigirTexto(chave, valor) {
  if (typeof valor !== 'string' || valor.length === 0) throw erroDeFiltro(chave, 'Informe um texto');
  return valor;
}

/** @param {string} chave @param {unknown} valor */
function exigirListaDeTexto(chave, valor) {
  if (!Array.isArray(valor) || valor.length === 0 || !valor.every((v) => typeof v === 'string')) {
    throw erroDeFiltro(chave, 'Informe uma lista de valores');
  }
  return valor;
}

/** @param {string} chave @param {unknown} valor */
function exigirNumero(chave, valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw erroDeFiltro(chave, 'Informe um número');
  return valor;
}

/** @param {string} chave @param {unknown} valor */
function exigirData(chave, valor) {
  const data = valor instanceof Date ? valor : new Date(/** @type {string} */ (valor));
  if (typeof valor !== 'string' && !(valor instanceof Date)) throw erroDeFiltro(chave, 'Informe uma data');
  if (Number.isNaN(data.getTime())) throw erroDeFiltro(chave, 'Informe uma data válida');
  return data;
}

/** Escapa `%`, `_` e `\` pra busca parcial tratar o texto literalmente. */
function escaparLike(texto) {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/** @param {string} chave @param {string} mensagem */
function erroDeFiltro(chave, mensagem) {
  return new AppError({
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: ERROR_CODES.VALIDATION_ERROR,
    message: mensagem,
    fields: { [`filtros.${chave}`]: [mensagem] },
  });
}
