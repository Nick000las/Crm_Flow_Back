import { vi } from 'vitest';
import { LISTAS_SEMEADAS, OPCOES_LEGADAS, OPCOES_SUGERIDAS } from '../constants.js';

/**
 * Só pra teste: as listas como o reconcile deixaria um tenant que já tinha
 * leads (keys antigas), no formato de `buscarOpcoesDoTenant`.
 *
 * @returns {import('../adapters/crm-options.repository.js').OpcaoLista[]}
 */
export function opcoesSemeadas() {
  return LISTAS_SEMEADAS.flatMap((kind) =>
    (OPCOES_LEGADAS[kind] ?? OPCOES_SUGERIDAS[kind]).map((opcao, indice) => ({
      id: `opcao-${kind}-${opcao.key}`,
      kind,
      key: opcao.key,
      label: opcao.label,
      color: opcao.color ?? null,
      position: indice,
      category: opcao.category ?? null,
      ativo: true,
    })),
  );
}

/**
 * Mock de `adapters/crm-options.repository.js` com o tenant já semeado:
 *
 *   vi.mock('../adapters/crm-options.repository.js', async () =>
 *     (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes());
 */
export function mockRepositorioOpcoes() {
  return {
    buscarOpcoesDoTenant: vi.fn(async () => opcoesSemeadas()),
    tenantTemLeads: vi.fn(async () => true),
    buscarTagsDosLeads: vi.fn(async () => []),
    inserirOpcoes: vi.fn(async (_tenantId, kind, opcoes) =>
      opcoes.map((opcao) => ({ id: `nova-${opcao.key}`, kind, ativo: true, color: null, category: null, ...opcao })),
    ),
    proximaPosicao: vi.fn(async () => 0),
    atualizarOpcao: vi.fn(),
    reordenarOpcoes: vi.fn(),
    excluirOpcao: vi.fn(),
    contarUsos: vi.fn(async () => new Map()),
  };
}
