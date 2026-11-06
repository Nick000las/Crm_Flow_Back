import { describe, expect, it } from 'vitest';
import { EVENTOS_OPORTUNIDADE } from '../constants/oportunidades.js';
import {
  diffDaOportunidade,
  novaOportunidadeDoLead,
  planejarEdicaoDoLead,
  planejarStatus,
  separarComerciais,
  validarComerciais,
} from './oportunidade-transicao.service.js';

const VALOR = 100;
const ACIMA_DO_LIMITE = 101;
const QUEBRADA = 1.5;
const AGORA = new Date('2026-11-05T12:00:00.000Z');
const ANTES = new Date('2026-10-01T12:00:00.000Z');
const opcao = (key, category) => ({ key, label: key, category, ativo: true });
const deal = (extras = {}) => ({
  status: 'novo',
  status_category: 'aberto',
  won_at: null,
  lost_at: null,
  lost_reason: null,
  ...extras,
});

describe('planejarStatus', () => {
  it('ganhar: carimba a data e pede o atendimento', () => {
    const plano = planejarStatus(deal(), opcao('ganho', 'ganho'), {}, AGORA);
    expect(plano.mudancas).toMatchObject({
      status_category: 'ganho',
      won_at: AGORA,
      lost_at: null,
    });
    expect(plano).toMatchObject({
      evento: EVENTOS_OPORTUNIDADE.GANHA,
      ganhou: true,
      statusMudou: true,
    });
  });

  it('perder: guarda o motivo', () => {
    const plano = planejarStatus(
      deal(),
      opcao('perdido', 'perdido'),
      { motivoPerda: 'preco' },
      AGORA,
    );
    expect(plano.mudancas).toMatchObject({ lost_at: AGORA, lost_reason: 'preco' });
    expect(plano.evento).toBe(EVENTOS_OPORTUNIDADE.PERDIDA);
    expect(plano.ganhou).toBe(false);
  });

  it('reabrir uma venda: limpa a data e avisa os atendimentos', () => {
    const plano = planejarStatus(
      deal({ status: 'ganho', status_category: 'ganho', won_at: ANTES }),
      opcao('novo', 'aberto'),
      {},
      AGORA,
    );
    expect(plano.mudancas.won_at).toBeNull();
    expect(plano).toMatchObject({ evento: EVENTOS_OPORTUNIDADE.REABERTA, reabriu: true });
  });

  it('reabrir uma perda: limpa o motivo, mas não há atendimento para avisar', () => {
    const plano = planejarStatus(
      deal({ status: 'perdido', status_category: 'perdido', lost_at: ANTES, lost_reason: 'preco' }),
      opcao('novo', 'aberto'),
      {},
      AGORA,
    );
    expect(plano.mudancas).toMatchObject({ lost_at: null, lost_reason: null });
    expect(plano.evento).toBe(EVENTOS_OPORTUNIDADE.REABERTA);
    expect(plano.reabriu).toBe(false);
  });

  it('perder com motivo nulo limpa o motivo; omitido mantém', () => {
    const perdida = deal({ status: 'perdido', status_category: 'perdido', lost_reason: 'preco' });
    const opcaoPerdida = opcao('perdido', 'perdido');
    expect(
      planejarStatus(perdida, opcaoPerdida, { motivoPerda: null }, AGORA).mudancas.lost_reason,
    ).toBeNull();
    expect(planejarStatus(perdida, opcaoPerdida, {}, AGORA).mudancas.lost_reason).toBe('preco');
  });

  it('andar entre status abertos não é evento de ganho nem de perda', () => {
    const plano = planejarStatus(deal(), opcao('proposta', 'aberto'), {}, AGORA);
    expect(plano.evento).toBe(EVENTOS_OPORTUNIDADE.STATUS_MUDOU);
    expect(plano.ganhou).toBe(false);
  });

  it('trocar de status dentro da mesma categoria mantém a data e não ganha de novo', () => {
    const plano = planejarStatus(
      deal({ status: 'ganho', status_category: 'ganho', won_at: ANTES }),
      opcao('ganho_parcial', 'ganho'),
      {},
      AGORA,
    );
    expect(plano.mudancas.won_at).toBe(ANTES);
    expect(plano.ganhou).toBe(false);
  });

  it('mesmo status: não conta como interação', () => {
    expect(planejarStatus(deal(), opcao('novo', 'aberto'), {}, AGORA).statusMudou).toBe(false);
  });
});

describe('diffDaOportunidade', () => {
  const CAMPOS = { amount: 'valor', status: 'status', won_at: 'ganhaEm' };

  it('só o que mudou, nas chaves do histórico', () => {
    expect(
      diffDaOportunidade(
        { amount: null, status: 'novo' },
        { amount: VALOR, status: 'novo' },
        CAMPOS,
      ),
    ).toEqual([{ campo: 'valor', antes: null, depois: VALOR }]);
  });

  it('campo fora das mudanças não entra; data vira texto', () => {
    expect(diffDaOportunidade({ status: 'novo', won_at: null }, { won_at: AGORA }, CAMPOS)).toEqual(
      [{ campo: 'ganhaEm', antes: null, depois: AGORA.toISOString() }],
    );
  });
});

describe('campos comerciais de /crm/leads', () => {
  const OPCOES = [
    { id: 'id-novo', ...opcao('novo', 'aberto') },
    { id: 'id-ganho', ...opcao('ganho', 'ganho') },
    { id: 'id-perdido', ...opcao('perdido', 'perdido') },
  ];
  const editar = (dados, extras = {}) =>
    planejarEdicaoDoLead(deal({ amount: null, ...extras }), OPCOES, dados, AGORA);

  it('separa comercial de contato e ignora o que não veio', () => {
    expect(
      separarComerciais({ nome: 'Ana', status: 'novo', valor: null, empresa: undefined }),
    ).toEqual({ comerciais: { status: 'novo', valor: null }, contato: { nome: 'Ana' } });
  });

  it('recusa o que a oportunidade não guarda', () => {
    expect(() => validarComerciais({ status: null })).toThrow('não pode ser limpo');
    expect(() => validarComerciais({ valor: -1 })).toThrow('valor');
    expect(() => validarComerciais({ probabilidadeFechamento: ACIMA_DO_LIMITE })).toThrow(
      'inteiro',
    );
    expect(() => validarComerciais({ probabilidadeFechamento: QUEBRADA })).toThrow('inteiro');
    expect(() => validarComerciais({ valor: 0, probabilidadeFechamento: 0 })).not.toThrow();
  });

  it('sem status, nasce no primeiro aberto ativo', () => {
    const opcoes = [{ ...OPCOES[0], ativo: false }, { ...opcao('proposta', 'aberto') }];
    expect(novaOportunidadeDoLead(opcoes, {})).toMatchObject({
      status: 'proposta',
      categoria: 'aberto',
    });
  });

  it('pipeline sem status aberto ativo é erro, não oportunidade sem status', () => {
    expect(() => novaOportunidadeDoLead([], {})).toThrow('status aberto');
  });

  it('o estágio é o id da opção; vindo os dois, vale o status', () => {
    expect(novaOportunidadeDoLead(OPCOES, { funilEstagioId: 'id-ganho' }).status).toBe('ganho');
    expect(
      novaOportunidadeDoLead(OPCOES, { funilEstagioId: 'id-ganho', status: 'novo' }).status,
    ).toBe('novo');
    expect(() => novaOportunidadeDoLead(OPCOES, { funilEstagioId: 'outro' })).toThrow('estágio');
  });

  it('data de conversão só em oportunidade ganha', () => {
    expect(() => novaOportunidadeDoLead(OPCOES, { dataConversao: AGORA })).toThrow('ganha');
    expect(novaOportunidadeDoLead(OPCOES, { status: 'ganho', dataConversao: ANTES }).ganhaEm).toBe(
      ANTES,
    );
    expect(() => editar({ dataConversao: AGORA })).toThrow('ganha');
    expect(editar({ status: 'ganho', dataConversao: ANTES }).mudancas.won_at).toBe(ANTES);
  });

  it('limpar a data de conversão não desfaz o ganho', () => {
    const ganha = { status: 'ganho', status_category: 'ganho', won_at: ANTES };
    expect(editar({ dataConversao: null }, ganha)).toBeNull();
  });

  it('sem mudança real, nada a gravar', () => {
    expect(editar({ status: 'novo', valor: null })).toBeNull();
    expect(editar({ valor: VALOR }, { amount: { toString: () => '100' } })).toBeNull();
  });

  it('só valor: edição comum, não conta como troca de status', () => {
    const plano = editar({ valor: VALOR });
    expect(plano.mudancas).toEqual({ amount: VALOR });
    expect(plano.evento).toBe(EVENTOS_OPORTUNIDADE.ATUALIZADA);
    expect(plano.statusMudou).toBeUndefined();
  });

  it('status com outro campo: a transição e o campo juntos', () => {
    const plano = editar({ status: 'ganho', valor: VALOR });
    expect(plano).toMatchObject({ evento: EVENTOS_OPORTUNIDADE.GANHA, ganhou: true });
    expect(plano.mudancas).toMatchObject({ status_category: 'ganho', amount: VALOR });
  });

  it('o responsável do lead alcança a oportunidade', () => {
    expect(editar({ usuarioResponsavelId: 'u2' }, { owner_id: 'u1' }).mudancas).toEqual({
      owner_id: 'u2',
    });
  });

  it('motivo sem status fica na oportunidade; ao reabrir, some', () => {
    expect(editar({ motivoPerda: 'preco' }).mudancas.lost_reason).toBe('preco');
    const perdida = {
      status: 'perdido',
      status_category: 'perdido',
      lost_at: ANTES,
      lost_reason: 'preco',
    };
    expect(
      editar({ status: 'novo', motivoPerda: 'prazo' }, perdida).mudancas.lost_reason,
    ).toBeNull();
  });
});
