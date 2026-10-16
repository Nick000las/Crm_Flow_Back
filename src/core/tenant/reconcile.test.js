import { describe, expect, it, vi } from 'vitest';
import { registrarModulos } from '#core/registry/modules.js';
import { reconciliarModulos } from './reconcile.js';

const crm = { key: 'crm', reconciliar: vi.fn() };
const kanban = { key: 'kanban_universal', reconciliar: vi.fn() };
registrarModulos([crm, kanban, { key: 'agendamento' } /* sem reconciliar */]);

describe('reconciliarModulos', () => {
  it('chama só os módulos pedidos que têm reconciliar', async () => {
    crm.reconciliar.mockResolvedValue([]);
    const resultado = await reconciliarModulos('t-1', ['crm', 'agendamento']);

    expect(crm.reconciliar).toHaveBeenCalledWith('t-1');
    expect(kanban.reconciliar).not.toHaveBeenCalled();
    expect(resultado).toEqual([{ moduleKey: 'crm', ok: true }]);
  });

  it('nunca lança: falha de um módulo vira item com erro e os outros seguem', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    crm.reconciliar.mockRejectedValue(new Error('banco fora'));
    kanban.reconciliar.mockResolvedValue([]);

    const resultado = await reconciliarModulos('t-1', ['crm', 'kanban_universal']);

    expect(resultado).toEqual([
      { moduleKey: 'crm', ok: false, erro: 'banco fora' },
      { moduleKey: 'kanban_universal', ok: true },
    ]);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
