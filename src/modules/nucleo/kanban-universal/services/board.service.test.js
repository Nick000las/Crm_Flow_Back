import { describe, it, expect, vi } from 'vitest';
import { listarCardsDoBoard, moverCardDeColuna } from './board.service.js';
import { buscarCardsPorBoard, moverCard } from '../adapters/cards.repository.js';

vi.mock('../adapters/cards.repository.js', () => ({
  buscarCardsPorBoard: vi.fn(),
  moverCard: vi.fn(),
}));

describe('listarCardsDoBoard', () => {
  it('repassa tenantId e boardId pro adapter e devolve o resultado dele', async () => {
    const cards = [{ id: 'card-1', boardId: 'board-1', colunaId: 'col-1', titulo: 'Tarefa' }];
    vi.mocked(buscarCardsPorBoard).mockResolvedValue(cards);

    const resultado = await listarCardsDoBoard('tenant-1', 'board-1');

    expect(buscarCardsPorBoard).toHaveBeenCalledWith('tenant-1', 'board-1');
    expect(resultado).toBe(cards);
  });
});

describe('moverCardDeColuna', () => {
  it('repassa tenantId, cardId e novaColunaId pro adapter', async () => {
    vi.mocked(moverCard).mockResolvedValue(undefined);

    await moverCardDeColuna('tenant-1', 'card-1', 'coluna-2');

    expect(moverCard).toHaveBeenCalledWith('tenant-1', 'card-1', 'coluna-2');
  });
});
