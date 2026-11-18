import { describe, expect, it } from 'vitest';

import { cardSchema } from '../schemas/card.schema.js';
import { nextOccurrence } from './recurrence.js';

const id = 'd6b67f66-266b-423e-8c86-c25ae13a739c';

describe('recorrência de calendário', () => {
  it.each([
    ['2026-12-31', 'diaria', '2027-01-01'],
    ['2026-12-28', 'semanal', '2027-01-04'],
    ['2028-01-31', 'mensal', '2028-02-29'],
    ['2026-01-31', 'mensal', '2026-02-28'],
  ])('%s com %s gera %s', (date, recurrence, expected) => {
    expect(nextOccurrence(date, recurrence)).toBe(expected);
  });
});

describe('colaboração persistida', () => {
  it('aceita arquivo binário para download e link HTTPS', () => {
    expect(
      cardSchema.safeParse({
        titulo: 'Entrega',
        dadosExtras: {
          anexos: [
            { id, nome: 'arquivo.txt', conteudo: 'data:application/octet-stream;base64,dGVzdGU=' },
          ],
          links: [{ id, nome: 'Referência', url: 'https://example.com' }],
          automacoes: [{ colunaId: id, concluir: true, responsavelId: null }],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { links: [{ id, nome: 'Script', url: 'javascript:alert(1)' }] },
    { anexos: [{ id, nome: 'Página', conteudo: 'data:text/html;base64,dGVzdGU=' }] },
    { recorrencia: 'anual' },
    { leadId: 'invalido' },
    { automacoes: [{ colunaId: id, concluir: 'sim', responsavelId: null }] },
  ])('rejeita metadados inválidos: %j', (dadosExtras) => {
    expect(cardSchema.safeParse({ titulo: 'Entrega', dadosExtras }).success).toBe(false);
  });
});
