import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { CHAVES_RECEITA, LISTA_MODOS_CNPJ } from '../constants.js';

// GET /crm/cnpj/:cnpj (M11b) — com ou sem máscara; o service confere o DV.
export const cnpjParamSchema = z.object({
  cnpj: z.string({ required_error: 'Informe o CNPJ' }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o CNPJ'),
});

const chaveReceita = z.enum(/** @type {[string, ...string[]]} */ ([...CHAVES_RECEITA]), {
  errorMap: () => ({ message: `Dado da Receita deve ser um de: ${CHAVES_RECEITA.join(', ')}` }),
});

// PUT /crm/configuracoes/cnpj (M11b) — a configuração inteira. `mapeamento`:
// dado da Receita → `id` do campo (o service confere campo ativo e tipo).
export const salvarConfigCnpjBodySchema = z
  .object({
    ativo: z.boolean({ required_error: 'Informe se o enriquecimento está ligado' }),
    modo: z.enum(/** @type {[string, ...string[]]} */ ([...LISTA_MODOS_CNPJ]), {
      errorMap: () => ({ message: 'Modo deve ser "manual" (lupa) ou "automatico"' }),
    }),
    sobrescrever: z.boolean({ required_error: 'Informe se sobrescreve campos já preenchidos' }),
    mapeamento: z.record(chaveReceita, z.string().uuid('Informe um campo válido')),
  })
  .strict();
