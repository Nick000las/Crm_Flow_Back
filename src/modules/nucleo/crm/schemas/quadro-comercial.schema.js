/**
 * @file Card com pessoa nova: o formulário de Novo lead, sem status (é a coluna).
 */
import { z } from 'zod';

import { DIRECOES_DE_ORDEM, ORDEM_PADRAO_DO_QUADRO, ORDENS_DO_QUADRO } from '../constants.js';
import { criarLeadBodySchema } from './leads.schema.js';
import { filtroLeadsSchema } from './leads-search.schema.js';
import { criarOportunidadeBodySchema, mudarStatusBodySchema } from './oportunidades.schema.js';

/** O mesmo filtro da tabela. `situacao` não entra: o quadro só tem cards ativos (P9). */
export const filtroDoQuadroSchema = filtroLeadsSchema.omit({ situacao: true });

export const ordemDoQuadroSchema = z
  .object({
    campo: z
      .enum(/** @type {[string, ...string[]]} */ (Object.keys(ORDENS_DO_QUADRO)), {
        errorMap: () => ({ message: 'Escolha uma ordenação válida' }),
      })
      .default(ORDEM_PADRAO_DO_QUADRO.campo),
    direcao: z
      .enum(/** @type {[string, ...string[]]} */ (Object.values(DIRECOES_DE_ORDEM)), {
        errorMap: () => ({ message: 'Direção deve ser asc ou desc' }),
      })
      .default(ORDEM_PADRAO_DO_QUADRO.direcao),
  })
  .strict();

/** O que o arraste grava junto com o status, para o formulário de campos faltantes. */
export const camposDoMoverSchema = mudarStatusBodySchema
  .pick({ motivoPerda: true, probabilidadeFechamento: true })
  .strict();

/** Card em pessoa existente: uma oportunidade nova para ela. */
export const cardDePessoaExistenteSchema = criarOportunidadeBodySchema
  .omit({ pipelineId: true, status: true })
  .extend({ leadId: z.string().uuid('Id de lead inválido') });

/** Card com pessoa nova: o formulário de Novo lead, sem status (é a coluna). */
export const cardDePessoaNovaSchema = criarLeadBodySchema;
