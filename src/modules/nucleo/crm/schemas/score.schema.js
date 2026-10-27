import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { FILTRO_OPERADORES, LIMITES_SCORE } from '../constants.js';

// Pontuação de leads (M14). Forma só: se o campo existe, se o operador
// serve pro tipo dele, sobreposição de faixas e os limites são regra por
// tenant (`score.service.js`).

const nome = (mensagem) =>
  z.string({ required_error: mensagem, invalid_type_error: mensagem }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, mensagem);

const inteiro = (mensagem) => z.number({ invalid_type_error: mensagem }).int(mensagem);

const condicao = z
  .object({
    campoId: z.string({ required_error: 'Escolha o campo da condição' }).uuid('Escolha o campo da condição'),
    operador: z.enum(/** @type {[string, ...string[]]} */ ([...FILTRO_OPERADORES]), {
      errorMap: () => ({ message: `Operador deve ser um de: ${FILTRO_OPERADORES.join(', ')}` }),
    }),
    valor: z.unknown().optional(),
  })
  .strict();

const regra = z
  .object({
    nome: nome('Dê um nome à regra'),
    ativo: z.boolean({ required_error: 'Informe se a regra está ligada' }),
    pontos: inteiro('Pontos devem ser um número inteiro')
      .min(-LIMITES_SCORE.PONTOS_MAX, `Pontos entre -${LIMITES_SCORE.PONTOS_MAX} e ${LIMITES_SCORE.PONTOS_MAX}`)
      .max(LIMITES_SCORE.PONTOS_MAX, `Pontos entre -${LIMITES_SCORE.PONTOS_MAX} e ${LIMITES_SCORE.PONTOS_MAX}`),
    condicoes: z.array(condicao),
  })
  .strict();

const faixa = z
  .object({
    chave: z.string().trim().optional(),
    rotulo: nome('Dê um nome à faixa'),
    minimo: inteiro('Mínimo deve ser um número inteiro').nullable(),
    maximo: inteiro('Máximo deve ser um número inteiro').nullable(),
    cor: z.string({ required_error: 'Escolha a cor da faixa' }).regex(/^#[0-9A-Fa-f]{6}$/, 'Cor no formato #RRGGBB'),
  })
  .strict();

// PUT /crm/configuracoes/score — regras e faixas inteiras.
export const salvarScoreBodySchema = z
  .object({
    regras: z.array(regra),
    faixas: z.array(faixa).min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Defina ao menos uma faixa'),
  })
  .strict();
