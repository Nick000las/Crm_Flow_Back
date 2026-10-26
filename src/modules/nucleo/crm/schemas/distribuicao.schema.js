import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { FILTRO_OPERADORES, LISTA_FALLBACK_DISTRIBUICAO, LISTA_TIPOS_DESTINO } from '../constants.js';

// Distribuição automática (M12). Forma só: se o campo existe, se o operador
// serve pro tipo dele, se usuário/grupo existem e os limites são regra por
// tenant (`distribuicao.service.js`).

const enumDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ ([...valores]), { errorMap: () => ({ message: mensagem }) });

const uuid = (mensagem) => z.string({ required_error: mensagem, invalid_type_error: mensagem }).uuid(mensagem);

const nome = (mensagem) =>
  z.string({ required_error: mensagem, invalid_type_error: mensagem }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, mensagem);

const condicao = z
  .object({
    campoId: uuid('Escolha o campo da condição'),
    operador: enumDe(FILTRO_OPERADORES, `Operador deve ser um de: ${FILTRO_OPERADORES.join(', ')}`),
    valor: z.unknown().optional(),
  })
  .strict();

const regra = z
  .object({
    id: uuid('Id de regra inválido').optional(),
    nome: nome('Dê um nome à regra'),
    ativo: z.boolean({ required_error: 'Informe se a regra está ligada' }),
    condicoes: z.array(condicao),
    destino: z
      .object({
        tipo: enumDe(LISTA_TIPOS_DESTINO, 'Destino deve ser "usuario" ou "grupo"'),
        id: uuid('Escolha o usuário ou o grupo de destino'),
      })
      .strict(),
  })
  .strict();

// PUT /crm/configuracoes/distribuicao — a configuração inteira; a ordem
// de `regras` é a ordem de avaliação.
export const salvarDistribuicaoBodySchema = z
  .object({
    ativo: z.boolean({ required_error: 'Informe se a distribuição está ligada' }),
    fallback: enumDe(LISTA_FALLBACK_DISTRIBUICAO, 'Sem regra que case: "rodizio_geral" ou "sem_responsavel"'),
    regras: z.array(regra),
  })
  .strict();

// POST e PUT /crm/configuracoes/distribuicao/grupos(/:id) — nome e a lista inteira de membros.
export const grupoBodySchema = z
  .object({
    nome: nome('Dê um nome ao grupo'),
    membros: z.array(uuid('Membro inválido')),
  })
  .strict();

export const grupoIdParamSchema = z.object({
  id: uuid('Id de grupo inválido'),
});
