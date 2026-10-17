import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LISTA_ACOES_DUPLICIDADE, LISTA_CAMPOS_DUPLICIDADE } from '../constants.js';

const enumDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ ([...valores]), { errorMap: () => ({ message: mensagem }) });

const regra = z
  .object({
    campo: enumDe(LISTA_CAMPOS_DUPLICIDADE, `Campo deve ser um de: ${LISTA_CAMPOS_DUPLICIDADE.join(', ')}`),
    acao: enumDe(LISTA_ACOES_DUPLICIDADE, 'Ação deve ser "warn" (avisar) ou "block" (bloquear)'),
    ativo: z.boolean({ required_error: 'Informe se a regra está ativa', invalid_type_error: 'Informe se a regra está ativa' }),
  })
  .strict();

// PUT /crm/configuracoes/duplicidade (M7) — campo não enviado fica como está.
export const salvarRegrasDuplicidadeBodySchema = z
  .object({
    regras: z
      .array(regra)
      .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe ao menos uma regra')
      .refine(
        (regras) => new Set(regras.map((item) => item.campo)).size === regras.length,
        'Cada campo aparece uma vez só',
      ),
  })
  .strict();
