import { z } from 'zod';
import { criarLeadBodySchema } from './leads.schema.js';
import { criarOportunidadeBodySchema } from './oportunidades.schema.js';

/** Card em pessoa existente: uma oportunidade nova para ela. */
export const cardDePessoaExistenteSchema = criarOportunidadeBodySchema
  .omit({ pipelineId: true, status: true })
  .extend({ leadId: z.string().uuid('Id de lead inválido') });

/** Card com pessoa nova: o formulário de Novo lead, sem status (é a coluna). */
export const cardDePessoaNovaSchema = criarLeadBodySchema;
