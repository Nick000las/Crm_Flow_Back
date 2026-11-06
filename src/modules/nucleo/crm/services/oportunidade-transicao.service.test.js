import { describe, expect, it } from 'vitest';
import { EVENTOS_OPORTUNIDADE } from '../constants/oportunidades.js';
import { diffDaOportunidade, planejarStatus } from './oportunidade-transicao.service.js';

const VALOR = 100;
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
