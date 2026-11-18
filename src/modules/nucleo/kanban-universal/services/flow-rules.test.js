import { describe, expect, it } from 'vitest';

import { batchSchema, flowRulesSchema } from '../schemas/flow.schema.js';
import { applyAutomation, dependencyError, transitionError } from './flow-rules.js';

const card = { id: 'a', responsavel_id: null, dados_extras: {} };
const column = {
  regras_fluxo: { exigirResponsavel: true, exigirPrazo: true, exigirChecklist: true },
};

describe('regras do fluxo Kanban', () => {
  it('rejeita ciclos diretos, indiretos e referências fora do quadro', () => {
    expect(dependencyError({ dependencias: ['a'] }, 'a', [card])).toMatch(/dele mesmo/);

    const other = { id: 'b', dados_extras: { dependencias: ['a'] } };

    expect(dependencyError({ dependencias: ['b'] }, 'a', [card, other])).toMatch(/ciclo/);
    expect(dependencyError({ dependencias: ['externo'] }, 'a', [card])).toMatch(/empresa/);
    expect(dependencyError({ dependencias: ['b'] }, 'a', [card, { id: 'b' }])).toBeNull();
  });

  it('exige dados e checklist efetivamente preenchido antes da transição', () => {
    expect(transitionError(card, column, [])).toMatch(/responsável/);

    const assigned = { ...card, responsavel_id: 'u1' };

    expect(transitionError(assigned, column, [])).toMatch(/prazo/);

    const scheduled = { ...assigned, dados_extras: { prazo: '2026-11-22', checklist: [] } };

    expect(transitionError(scheduled, column, [])).toMatch(/checklist/);
    scheduled.dados_extras.checklist.push({ concluido: true });
    expect(transitionError(scheduled, column, [])).toBeNull();
  });

  it('bloqueia dependência arquivada pendente e libera dependência concluída', () => {
    const dependent = { ...card, dados_extras: { dependencias: ['b'] } };

    expect(
      transitionError(dependent, {}, [{ id: 'b', archived_at: new Date(), dados_extras: {} }]),
    ).toMatch(/dependências/);

    expect(
      transitionError(dependent, {}, [{ id: 'b', dados_extras: { prazoConcluido: true } }]),
    ).toBeNull();

    expect(
      transitionError({ ...card, dados_extras: { bloqueio: 'Contrato pendente' } }, {}, []),
    ).toMatch(/bloqueio/);
  });

  it('calcula prazo cruzando ano e preserva demais detalhes sem mutação', () => {
    const original = { ...card, dados_extras: { descricao: 'Contexto', prazoConcluido: true } };
    const days = 2;

    expect(
      applyAutomation(original, { prazoDias: days, responsavelId: 'u1' }, '2026-12-31'),
    ).toEqual({
      assignee: 'u1',
      details: { descricao: 'Contexto', prazoConcluido: false, prazo: '2027-01-02' },
    });

    expect(original.dados_extras.prazoConcluido).toBe(true);

    expect(
      applyAutomation(card, { prazoDias: 0, concluir: true }, '2026-11-22').details,
    ).toMatchObject({ prazo: '2026-11-22', prazoConcluido: true });
  });

  it('valida destino, duplicidade e limites do lote e da configuração', () => {
    const snapshot = {
      id: '11111111-1111-4111-8111-111111111111',
      expectedUpdatedAt: '2026-11-22T00:00:00.000Z',
    };

    expect(batchSchema.safeParse({ cards: [snapshot], acao: 'mover' }).success).toBe(false);

    expect(batchSchema.safeParse({ cards: [snapshot, snapshot], acao: 'arquivar' }).success).toBe(
      false,
    );

    expect(
      batchSchema.safeParse({ cards: [snapshot], acao: 'atribuir', responsavelId: null }).success,
    ).toBe(true);

    const invalidDays = -2;

    expect(flowRulesSchema.safeParse({ automacao: { prazoDias: invalidDays } }).success).toBe(
      false,
    );
  });
});
