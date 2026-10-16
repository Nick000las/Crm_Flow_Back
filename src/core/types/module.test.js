import { describe, expect, it } from 'vitest';
import { MODULES } from '#api/modules.js';
import { assertModule } from './module.js';

const base = { key: 'crm', name: 'CRM', registerRoutes() {} };

describe('assertModule — featureFlags e reconciliar', () => {
  it('aceita catálogo com o prefixo do módulo e reconciliar função', () => {
    expect(() => assertModule({ ...base, featureFlags: ['crm.listas'], reconciliar: async () => [] })).not.toThrow();
  });

  it('rejeita flag sem o prefixo do módulo', () => {
    expect(() => assertModule({ ...base, featureFlags: ['kanban.x'] })).toThrow(/deve começar com "crm\."/);
  });

  it('rejeita featureFlags que não é array e reconciliar que não é função', () => {
    expect(() => assertModule({ ...base, featureFlags: 'crm.x' })).toThrow(/array/);
    expect(() => assertModule({ ...base, reconciliar: 'sim' })).toThrow(/função/);
  });

  it('todo módulo registrado passa no contrato e as flags não se repetem', () => {
    const modulos = MODULES.map(assertModule);
    const flags = modulos.flatMap((modulo) => modulo.featureFlags ?? []);
    expect(new Set(flags).size).toBe(flags.length);
  });
});
