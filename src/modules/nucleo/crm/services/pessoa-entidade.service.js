import {
  buscarPessoasPorIds,
  buscarSituacaoDasPessoas,
} from '../adapters/crm-pessoa-entidade.repository.js';
import { ENTIDADE_PESSOA } from '../constants.js';
import { customFieldsParaApi } from './field-schema.service.js';
import { identificadorDoLayout } from './layout.service.js';
import { identificadorVisivel, obterSchemaDoPapel } from './permissoes.service.js';
import { pessoasVisiveis } from './visibilidade-pipeline.service.js';

/**
 * SERVICE: a pessoa como entidade que outro módulo referencia sem copiar dado
 * (contrato `ProvedorDeEntidade`, M6). Nome vem daqui a cada leitura.
 *
 * Anonimizado, na lixeira ou inexistente fica fora de `descrever`, e o motor
 * mostra "Registro restrito". Mesclado responde pelo principal desde já,
 * antes de a varredura trocar o id gravado.
 */

/**
 * O identificador do layout, se o papel o vê e tem valor. `nome` é a
 * alternativa: não aceita restrição por papel.
 *
 * @param {Record<string, any>} lead
 * @param {{ chave: string, coluna?: string } | null} identificador
 * @param {{ definicoes: any[] }} schema
 */
export function tituloDaPessoa(lead, identificador, schema) {
  if (!identificador) {
    return lead.nome;
  }
  const valor = identificador.coluna
    ? lead[identificador.coluna]
    : customFieldsParaApi(schema.definicoes, lead.custom_fields ?? {})[identificador.chave];
  return typeof valor === 'string' && valor.trim() ? valor : lead.nome;
}

/**
 * @param {import('#core/types/module.js').TenantContext} context
 * @param {string[]} ids
 * @returns {Promise<{ id: string, idAtual: string, titulo: string, subtitulo: null, destaques: [] }[]>}
 */
async function descreverPessoas({ tenantId, role }, ids) {
  const situacoes = await buscarSituacaoDasPessoas(tenantId, ids);
  const ativas = situacoes.filter((situacao) => !situacao.anonimizado && !situacao.excluido);
  const permitidas = await pessoasVisiveis(
    tenantId,
    ativas.map((situacao) => situacao.atual),
    role,
  );
  const visiveis = ativas.filter((situacao) => permitidas.has(situacao.atual));
  if (visiveis.length === 0) {
    return [];
  }

  const [leads, schema, identificador] = await Promise.all([
    buscarPessoasPorIds(tenantId, [...new Set(visiveis.map((situacao) => situacao.atual))]),
    obterSchemaDoPapel(tenantId, role),
    identificadorDoLayout(tenantId),
  ]);
  const visivel = identificadorVisivel(identificador, schema);
  const porId = new Map(leads.map((lead) => [lead.id, lead]));

  return visiveis.flatMap(({ origem, atual }) => {
    const lead = porId.get(atual);
    return lead
      ? [
          {
            id: origem,
            idAtual: atual,
            titulo: tituloDaPessoa(lead, visivel, schema),
            subtitulo: null,
            destaques: [],
          },
        ]
      : [];
  });
}

/**
 * Sem usuário: é chamado pela varredura. Lead na lixeira sem mesclagem mantém
 * o id, porque ainda pode ser restaurado; a purga o transforma em `null`.
 *
 * @param {string} tenantId
 * @param {string[]} ids
 * @returns {Promise<Record<string, string | null>>}
 */
async function resolverVinculosDePessoas(tenantId, ids) {
  const situacoes = await buscarSituacaoDasPessoas(tenantId, ids);
  const porOrigem = new Map(situacoes.map((situacao) => [situacao.origem, situacao]));
  return Object.fromEntries(
    ids.map((id) => {
      const situacao = porOrigem.get(id);
      return [id, !situacao || situacao.anonimizado ? null : situacao.atual];
    }),
  );
}

/** @type {import('#core/types/module.js').ProvedorDeEntidade} */
export const provedorDePessoa = {
  tipo: ENTIDADE_PESSOA,
  descrever: descreverPessoas,
  rotaFicha: (id) => `/crm/leads/${id}`,
  resolverVinculos: resolverVinculosDePessoas,
};
