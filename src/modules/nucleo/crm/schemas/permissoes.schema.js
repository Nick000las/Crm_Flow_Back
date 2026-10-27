import { z } from 'zod';
import { LISTA_ACESSOS_CAMPO, PAPEIS_COM_PERMISSAO } from '../constants.js';

// PUT /crm/configuracoes/permissoes (M13): por papel configurável, o mapa
// inteiro `{ [campoId]: 'edit' | 'view' | 'hidden' }` (campo ausente = edit).
// Se o campo existe e pode ser restringido é regra por tenant (service).

const acessosDoPapel = z.record(
  z.string().uuid('Campo inválido'),
  z.enum(/** @type {[string, ...string[]]} */ ([...LISTA_ACESSOS_CAMPO]), {
    errorMap: () => ({ message: 'Acesso deve ser "edit", "view" ou "hidden"' }),
  }),
);

export const salvarPermissoesBodySchema = z
  .object(Object.fromEntries(PAPEIS_COM_PERMISSAO.map((papel) => [papel, acessosDoPapel.optional()])))
  .strict()
  .refine((body) => Object.values(body).some((acessos) => acessos !== undefined), 'Informe as permissões de ao menos um papel');
