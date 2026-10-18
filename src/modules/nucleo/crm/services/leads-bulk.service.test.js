import { describe, it, expect, vi, beforeEach } from 'vitest';
import { erroDeValidacao } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { alteracoesDoLead, editarLeadsEmMassa } from './leads-bulk.service.js';
import { buscadorDeTags } from './listas.service.js';
import { atualizarLeadExistente } from './leads.service.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { editarEmMassaBodySchema } from '../schemas/leads-bulk.schema.js';
import { EDICAO_EM_MASSA } from '../constants.js';

vi.mock('../adapters/leads.repository.js', () => ({ buscarLeadPorId: vi.fn() }));
vi.mock('./leads.service.js', () => ({ atualizarLeadExistente: vi.fn() }));
vi.mock('./field-schema.service.js', () => ({
  obterSchemaCampos: vi.fn().mockResolvedValue({
    listas: {
      tag: [
        { key: 'vip', label: 'VIP', ativo: true },
        { key: 'b2b', label: 'B2B', ativo: true },
      ],
    },
  }),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const USUARIO = '00000000-0000-0000-0000-0000000000aa';
const LEAD_OK = '00000000-0000-0000-0000-000000000011';
const LEAD_REGRA = '00000000-0000-0000-0000-000000000012';
const LEAD_SUMIU = '00000000-0000-0000-0000-000000000013';
const LEAD_IGUAL = '00000000-0000-0000-0000-000000000014';
const DIGITOS_SUFIXO_UUID = 12;
const LEADS_NO_LOTE = 4;
const FALHAS_NO_LOTE = 2;
const LEADS_COM_MUDANCA = 2;

const LEADS = {
  [LEAD_OK]: { id: LEAD_OK, status: 'novo', fonte_lead: null, usuario_responsavel_id: null, tags: ['vip'] },
  [LEAD_REGRA]: { id: LEAD_REGRA, status: 'novo', fonte_lead: null, usuario_responsavel_id: null, tags: [] },
  [LEAD_IGUAL]: { id: LEAD_IGUAL, status: 'perdido', fonte_lead: null, usuario_responsavel_id: null, tags: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  buscarLeadPorId.mockImplementation(async (_tenant, id) => LEADS[id]);
  atualizarLeadExistente.mockImplementation(async (_tenant, id) => {
    if (id === LEAD_REGRA) throw erroDeValidacao('motivoPerda', '"Motivo da perda" é obrigatório neste status');
    return { id };
  });
});

describe('editarLeadsEmMassa', () => {
  it('relatório parcial: um atualizado, um barrado por regra (M8), um inexistente, um inalterado', async () => {
    const relatorio = await editarLeadsEmMassa(
      TENANT,
      { ids: [LEAD_OK, LEAD_REGRA, LEAD_SUMIU, LEAD_IGUAL], alteracoes: { status: 'perdido' } },
      USUARIO,
    );

    expect(relatorio).toMatchObject({ total: LEADS_NO_LOTE, atualizados: 1, inalterados: 1, falhas: FALHAS_NO_LOTE });
    expect(relatorio.resultados).toEqual([
      { id: LEAD_OK, ok: true },
      {
        id: LEAD_REGRA,
        ok: false,
        erro: expect.objectContaining({ statusCode: HTTP_STATUS.BAD_REQUEST, fields: { motivoPerda: [expect.any(String)] } }),
      },
      { id: LEAD_SUMIU, ok: false, erro: expect.objectContaining({ statusCode: HTTP_STATUS.NOT_FOUND }) },
      { id: LEAD_IGUAL, ok: true, inalterado: true },
    ]);
    // Mesmo caminho do PUT, com quem editou de autor; o lead sem mudança nem chega lá.
    expect(atualizarLeadExistente).toHaveBeenCalledWith(TENANT, LEAD_OK, { status: 'perdido' }, USUARIO);
    expect(atualizarLeadExistente).not.toHaveBeenCalledWith(TENANT, LEAD_IGUAL, expect.anything(), USUARIO);
  });

  it('erro que não é de negócio sai genérico e não para os outros', async () => {
    atualizarLeadExistente.mockRejectedValueOnce(new Error('connection reset'));
    const relatorio = await editarLeadsEmMassa(TENANT, { ids: [LEAD_OK, LEAD_REGRA], alteracoes: { status: 'ganho' } }, USUARIO);

    expect(relatorio.resultados[0].erro).toEqual(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(relatorio.resultados[0].erro.message).not.toContain('connection');
    expect(atualizarLeadExistente).toHaveBeenCalledTimes(LEADS_COM_MUDANCA);
  });
});

describe('alteracoesDoLead (tags)', () => {
  const encontrarTag = buscadorDeTags([
    { key: 'vip', label: 'VIP', ativo: true },
    { key: 'b2b', label: 'B2B', ativo: true },
  ]);

  it('soma e tira sobre as tags do lead; texto novo vai como texto', () => {
    const input = alteracoesDoLead({ tags: ['vip'] }, { tags: { adicionar: ['b2b', 'Evento SP'], remover: ['VIP'] } }, encontrarTag);
    expect(input).toEqual({ tags: ['b2b', 'Evento SP'] });
  });

  it('adicionar o que já tem / tirar o que não tem → nada a mudar', () => {
    expect(alteracoesDoLead({ tags: ['vip'] }, { tags: { adicionar: ['vip'], remover: ['b2b'] } }, encontrarTag)).toEqual({});
  });

  it('responsável null tira o responsável; o mesmo valor não entra', () => {
    expect(alteracoesDoLead({ usuario_responsavel_id: USUARIO }, { usuarioResponsavelId: null }, encontrarTag)).toEqual({
      usuarioResponsavelId: null,
    });
    expect(alteracoesDoLead({ usuario_responsavel_id: USUARIO }, { usuarioResponsavelId: USUARIO }, encontrarTag)).toEqual({});
  });
});

describe('editarEmMassaBodySchema', () => {
  it('rejeita id repetido, sem alteração e acima do limite', () => {
    expect(editarEmMassaBodySchema.safeParse({ ids: [LEAD_OK, LEAD_OK], alteracoes: { status: 'novo' } }).success).toBe(false);
    expect(editarEmMassaBodySchema.safeParse({ ids: [LEAD_OK], alteracoes: { tags: { adicionar: [] } } }).success).toBe(false);
    const demais = Array.from({ length: EDICAO_EM_MASSA.MAX_LEADS + 1 }, (_, indice) =>
      `00000000-0000-0000-0000-${String(indice).padStart(DIGITOS_SUFIXO_UUID, '0')}`,
    );
    expect(editarEmMassaBodySchema.safeParse({ ids: demais, alteracoes: { status: 'novo' } }).success).toBe(false);
  });
});
