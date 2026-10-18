import { z } from 'zod';
import { BRAZIL_PHONE, TEXT_LIMITS } from '#shared/constants/index.js';

// Camada 1 (docs/crm/plano-campos-hibridos.md) — sempre ativa, mesmo nível
// de nome/telefone. `email`/`telefone` são cada um opcional isoladamente
// (regra "pelo menos um dos dois" é validada no service, contra o objeto
// completo — não dá pra expressar "A ou B obrigatório" por campo isolado).
/** @param {string} mensagem */
export const opcaoDeLista = (mensagem) =>
  z.string({ invalid_type_error: mensagem }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, mensagem).optional();

const camposCamada1 = {
  email: z.string({ invalid_type_error: 'Informe um e-mail válido' }).trim().email('Informe um e-mail válido').optional(),
  telefone: z
    .string({ invalid_type_error: 'Informe um telefone válido' })
    .min(BRAZIL_PHONE.LANDLINE_LENGTH, 'Informe um telefone válido')
    .optional(),
  // Listas configuráveis (M3): a opção válida depende do tenant, então só a
  // forma é checada aqui; `leads.service.js` confere contra `crm_option`.
  fonteLead: opcaoDeLista('Origem do lead inválida'),
  status: opcaoDeLista('Status de lead inválido'),
  tags: z
    .array(z.string({ invalid_type_error: 'Tag inválida' }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Tag vazia'))
    .optional(),
  ultimaInteracaoEm: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
  // M10: omitido (ou vazio) → a primeira palavra do nome; `null` na edição
  // volta ao derivado. Ver primeiro-nome.service.js.
  primeiroNome: z.string({ invalid_type_error: 'Informe um primeiro nome válido' }).trim().optional(),
};

// Camada 2 — nativa, mas só visível/obrigatória se o tenant ligar (ver
// configuração em `crm_field`, via field-schema.service.js). O `service`
// valida a obrigatoriedade dinâmica; aqui é só forma/tipo de cada campo.
const camposCamada2 = {
  empresa: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  cargo: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  cpf: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  cnpj: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  cidade: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  uf: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  cep: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  endereco: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  campanhaUtm: z.string({ invalid_type_error: 'Informe um valor válido' }).optional(),
  dataConversao: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
  probabilidadeFechamento: z.number({ invalid_type_error: 'Informe um número válido' }).optional(),
  dataPrevistaFechamento: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
  motivoPerda: opcaoDeLista('Motivo de perda inválido'),
  leadScore: z.number({ invalid_type_error: 'Informe um número válido' }).optional(),
  proximoFollowup: z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).optional(),
};

export const usuarioResponsavelIdSchema = z
  .string({ invalid_type_error: 'Informe um responsável válido' })
  .uuid('Informe um responsável válido');

/**
 * Na edição, `null` limpa o campo e omitir mantém o valor (ver
 * `leads.repository.js#atualizarLead`) — por isso as Camadas 1/2 aceitam
 * `null` lá, mas não na criação.
 *
 * @param {Record<string, z.ZodTypeAny>} campos
 */
// M7: o usuário viu o aviso de possível duplicado (409 DUPLICATE_WARNING)
// e confirmou. Não destrava `block`.
const ignorarDuplicados = z.boolean({ invalid_type_error: 'Informe se deve ignorar duplicados' }).optional();

function aceitandoNull(campos) {
  return Object.fromEntries(Object.entries(campos).map(([chave, schema]) => [chave, schema.nullable()]));
}

export const criarLeadBodySchema = z
  .object({
    nome: z
      .string({
        required_error: 'Informe o nome do lead',
        invalid_type_error: 'Informe um nome válido',
      })
      .trim()
      .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do lead'),
    // Opcional: estágios do funil ficam em aberto até a integração com o
    // Kanban (nenhum tenant tem estágio hoje), então o lead pode nascer
    // sem estágio — `funil_estagio_id` é nullable no banco.
    funilEstagioId: z
      .string({ invalid_type_error: 'Informe um estágio de funil válido' })
      .uuid('Informe um estágio de funil válido')
      .optional(),
    valor: z.number({ invalid_type_error: 'Informe um valor válido' }).optional(),
    // Validação de forma só ("é um objeto") — obrigatoriedade/tipo por
    // chave depende dos campos personalizados (`crm_field`), que é dado de
    // banco por tenant, então só o service consegue validar isso de verdade.
    customFields: z.record(z.unknown()).optional(),
    // Omitido → o próprio usuário que está criando (ver leads.service.js).
    usuarioResponsavelId: usuarioResponsavelIdSchema.optional(),
    ignorarDuplicados,
    ...camposCamada1,
    ...camposCamada2,
  })
  // Primeira linha de defesa por UX (erro 400 claro na borda) — a
  // constraint `chk_leads_email_ou_telefone` no banco é a rede de
  // segurança final, o service repete essa checagem antes do INSERT.
  .refine((dados) => Boolean(dados.email) || Boolean(dados.telefone), {
    message: 'Informe e-mail ou telefone',
    path: ['email'],
  });

// Tudo opcional — edição é parcial. Campo omitido mantém o valor; `null`
// limpa (exceto `nome`/`funilEstagioId`, que nunca ficam vazios); em
// `customFields`, `{ chave: null }` remove a chave. Regras que dependem do
// lead atual ("sobra e-mail ou telefone", campo obrigatório não pode ser
// limpo) ficam no service.
export const atualizarLeadBodySchema = z.object({
  nome: z
    .string({ invalid_type_error: 'Informe um nome válido' })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do lead')
    .optional(),
  funilEstagioId: z
    .string({ invalid_type_error: 'Informe um estágio de funil válido' })
    .uuid('Informe um estágio de funil válido')
    .optional(),
  valor: z.number({ invalid_type_error: 'Informe um valor válido' }).nullable().optional(),
  usuarioResponsavelId: usuarioResponsavelIdSchema.nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
  ignorarDuplicados,
  ...aceitandoNull(camposCamada1),
  ...aceitandoNull(camposCamada2),
});

// POST /crm/leads/merge (M7) — `escolhas`: por chave da API (inclusive a do
// personalizado), de qual lead vem o valor. Sem escolha: o do principal,
// ou o do secundário se o do principal estiver vazio.
export const mesclarLeadsBodySchema = z
  .object({
    principalId: z.string({ required_error: 'Informe o lead que fica' }).uuid('Id de lead inválido'),
    secundarioId: z.string({ required_error: 'Informe o lead que será descartado' }).uuid('Id de lead inválido'),
    escolhas: z
      .record(z.enum(['principal', 'secundario'], { errorMap: () => ({ message: 'Escolha "principal" ou "secundario"' }) }))
      .optional(),
  })
  .strict();

// POST /crm/leads/duplicados — checagem ao vivo do formulário (não salva).
// `leadId` = o lead em edição (fica de fora dos candidatos).
export const checarDuplicadosBodySchema = z
  .object({
    leadId: z.string().uuid('Id de lead inválido').optional(),
    email: z.string().optional(),
    telefone: z.string().optional(),
    cnpj: z.string().optional(),
    cpf: z.string().optional(),
  })
  .strict();

export const leadIdParamSchema = z.object({
  id: z.string({ required_error: 'Informe o id do lead' }).uuid('Id de lead inválido'),
});
