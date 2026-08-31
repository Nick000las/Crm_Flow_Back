import { describe, expect, it } from 'vitest';
import { cardSchema, cardUpdateSchema } from './card.schema.js';

const id = 'd6b67f66-266b-423e-8c86-c25ae13a739c';
const item = { id, titulo: 'Revisar entrega', concluido: false };
const label = { id, nome: 'Cliente', cor: 'azul' };
const details = {
  prioridade: 'urgente',
  prazo: '2028-02-29',
  prazoConcluido: false,
  descricao: 'Contexto',
  etiquetas: [label],
  checklist: [item],
  leadId: 'legacy-lead',
};

describe('contrato dos detalhes de cards', () => {
  it('valida campos comuns e preserva metadados do tipo de quadro', () => {
    expect(cardSchema.parse({ titulo: 'Entrega', dadosExtras: details }).dadosExtras).toEqual(
      details,
    );
  });
  it.each([
    { prioridade: 'critica' },
    { prazo: '2027-02-29' },
    { prazo: '2026-04-31' },
    { prazo: '16/10/2026' },
    { prazoConcluido: 'true' },
    { etiquetas: [{ ...label, cor: 'invalid' }] },
    { etiquetas: [label, label] },
    { checklist: [item, item] },
    { checklist: [{ ...item, titulo: ' ' }] },
    { checklist: [{ ...item, concluido: 'false' }] },
  ])('rejeita detalhes inválidos %j', (dadosExtras) => {
    expect(cardSchema.safeParse({ titulo: 'Entrega', dadosExtras }).success).toBe(false);
  });
  it('aceita remoção de prazo e listas vazias sem preencher os campos omitidos', () => {
    const dadosExtras = { prazo: null, etiquetas: [], checklist: [] };
    expect(cardUpdateSchema.parse({ dadosExtras }).dadosExtras).toEqual(dadosExtras);
  });
  it('rejeita atualização que só contém a versão do card', () => {
    expect(
      cardUpdateSchema.safeParse({ expectedUpdatedAt: '2026-10-15T12:00:00.000Z' }).success,
    ).toBe(false);
  });
  it('mantém compatibilidade com cards simples', () => {
    expect(cardSchema.parse({ titulo: 'Tarefa antiga' })).toEqual({ titulo: 'Tarefa antiga' });
  });
});
