import { z } from 'zod';
import { PAGINATION, TEXT_LIMITS } from '#shared/constants/index.js';
import {
  BUSCA_LEADS,
  FILTRO_OPERADORES,
  LISTA_CICLOS_DE_VIDA,
  LISTA_SITUACOES_LEAD,
} from '../constants.js';

// Forma só — `chave`/`valor` dependem dos campos ativos do tenant (Camadas
// 2/3 são dado de banco), então tipo do valor e compatibilidade com o
// operador são validados em `lead-filter.service.js`.
const filtroCampoSchema = z.object({
  chave: z
    .string({
      required_error: 'Informe o campo do filtro',
      invalid_type_error: 'Campo de filtro inválido',
    })
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o campo do filtro'),
  operador: z.enum(FILTRO_OPERADORES, {
    required_error: 'Informe o operador do filtro',
    invalid_type_error: 'Operador de filtro inválido',
  }),
  valor: z.unknown().optional(),
});

/** `AAAA-MM-DD`. */
const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O texto é um dia que existe no calendário (`2026-02-30` não passa). Fora do
 * formato, quem responde é a regex (uma mensagem só).
 */
const diaExiste = (texto) => {
  if (!PADRAO_DIA.test(texto)) return true;
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};

/**
 * FC4: um dia no fuso do tenant, inclusivo (`Ate` inclui o dia inteiro). Fica
 * texto, não `Date`: é um dia do calendário, não um instante.
 */
const dia = () =>
  z
    .string({ invalid_type_error: 'Informe uma data no formato AAAA-MM-DD' })
    .regex(PADRAO_DIA, 'Informe uma data no formato AAAA-MM-DD')
    .refine(diaExiste, 'Informe uma data válida')
    .optional();

const quantidade = () =>
  z
    .number({ invalid_type_error: 'Informe uma quantidade válida' })
    .int('Informe uma quantidade inteira')
    .min(0, 'A quantidade não pode ser negativa')
    .optional();

/**
 * Filtro de leads sem paginação — mesmo formato salvo em
 * `crm_filter_views.filtros` e aceito por POST /crm/export.
 */
export const filtroLeadsSchema = z.object({
  busca: z
    .string({ invalid_type_error: 'Informe um texto de busca válido' })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH)
    .optional(),
  funilEstagioId: z.string().uuid('Informe um estágio de funil válido').optional(),
  usuarioResponsavelId: z.string().uuid('Informe um responsável válido').optional(),
  // Sem responsável, ou com o responsável desativado — o mesmo critério do
  // resumo `crm.esfriando_sem_responsavel`. Não combina com `usuarioResponsavelId`.
  semResponsavel: z
    .boolean({ invalid_type_error: 'Sem responsável deve ser verdadeiro ou falso' })
    .optional(),
  valorMin: z.number({ invalid_type_error: 'Informe um valor válido' }).optional(),
  valorMax: z.number({ invalid_type_error: 'Informe um valor válido' }).optional(),
  criadoDe: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
  criadoAte: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
  // M5: sem ela, só os ativos. `arquivados`/`lixeira` exigem `crm.arquivo`.
  situacao: z
    .enum(/** @type {[string, ...string[]]} */ ([...LISTA_SITUACOES_LEAD]), {
      errorMap: () => ({ message: `Situação deve ser uma de: ${LISTA_SITUACOES_LEAD.join(', ')}` }),
    })
    .optional(),
  // M9: só os leads esfriando agora. Exige `crm.inatividade`.
  esfriando: z.boolean({ invalid_type_error: 'Esfriando deve ser verdadeiro ou falso' }).optional(),
  // M14: a chave da faixa de score (`frio`, `morno`, `quente`…). Exige `crm.score`.
  faixaScore: z
    .string({ invalid_type_error: 'Faixa de score inválida' })
    .trim()
    .min(1, 'Faixa de score inválida')
    .optional(),
  // FC4: ciclo de vida calculado das oportunidades visíveis ("é um dos").
  cicloDeVida: z
    .array(
      z.enum(/** @type {[string, ...string[]]} */ ([...LISTA_CICLOS_DE_VIDA]), {
        errorMap: () => ({
          message: `Ciclo de vida deve ser um de: ${LISTA_CICLOS_DE_VIDA.join(', ')}`,
        }),
      }),
      { invalid_type_error: 'Informe uma lista de ciclos de vida' },
    )
    .min(1, 'Escolha ao menos um ciclo de vida')
    .refine((lista) => new Set(lista).size === lista.length, 'Ciclo de vida repetido')
    .optional(),
  // FC4: "Cliente desde" e "Última compra". `De > Ate` é conferido no filtro.
  clienteDesdeDe: dia(),
  clienteDesdeAte: dia(),
  ultimaCompraDe: dia(),
  ultimaCompraAte: dia(),
  // FC4: oportunidades abertas. `Min > Max` é conferido no filtro.
  oportunidadesAbertasMin: quantidade(),
  oportunidadesAbertasMax: quantidade(),
  filtros: z
    .array(filtroCampoSchema)
    .max(BUSCA_LEADS.MAX_FILTROS, `Use no máximo ${BUSCA_LEADS.MAX_FILTROS} filtros`)
    .default([]),
});

export const pesquisarLeadsBodySchema = filtroLeadsSchema.extend({
  paginacao: z
    .object({
      pagina: z.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
      tamanho: z
        .number()
        .int()
        .min(PAGINATION.MIN_ITEMS_PER_PAGE)
        .max(BUSCA_LEADS.TAMANHO_MAXIMO)
        .default(BUSCA_LEADS.TAMANHO_PADRAO),
    })
    .default({}),
});

// GET /crm/leads?pagina=&tamanho= — mesma paginação do /search, vinda da
// query string (por isso o `coerce`).
export const listarLeadsQuerySchema = z.object({
  pagina: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
  tamanho: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_ITEMS_PER_PAGE)
    .max(BUSCA_LEADS.TAMANHO_MAXIMO)
    .default(BUSCA_LEADS.TAMANHO_PADRAO),
});
