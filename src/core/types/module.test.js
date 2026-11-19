import { describe, expect, it } from 'vitest';
import { MODULES } from '#api/modules.js';
import { assertModule } from './module.js';

const base = { key: 'crm', name: 'CRM', registerRoutes() {} };

describe('assertModule — featureFlags e reconciliar', () => {
  it('aceita catálogo com o prefixo do módulo e reconciliar função', () => {
    expect(() =>
      assertModule({ ...base, featureFlags: ['crm.listas'], reconciliar: async () => [] }),
    ).not.toThrow();
  });

  it('rejeita flag sem o prefixo do módulo', () => {
    expect(() => assertModule({ ...base, featureFlags: ['kanban.x'] })).toThrow(
      /deve começar com "crm\."/,
    );
  });

  it('rejeita featureFlags que não é array e reconciliar que não é função', () => {
    expect(() => assertModule({ ...base, featureFlags: 'crm.x' })).toThrow(/array/);
    expect(() => assertModule({ ...base, reconciliar: 'sim' })).toThrow(/função/);
    expect(() => assertModule({ ...base, aoLigarFeatures: 'sim' })).toThrow(/aoLigarFeatures/);
    expect(() => assertModule({ ...base, aoLigarFeatures: async () => {} })).not.toThrow();
  });

  it('registerPublicRoutes é opcional, mas se vier precisa ser função', () => {
    expect(() => assertModule({ ...base, registerPublicRoutes() {} })).not.toThrow();
    expect(() => assertModule({ ...base, registerPublicRoutes: '/f' })).toThrow(
      /registerPublicRoutes/,
    );
  });

  it('valida os provedores de quadro e de entidade', () => {
    const metodos = (nomes) => Object.fromEntries(nomes.map((nome) => [nome, async () => []]));
    const quadro = {
      boardType: 'oportunidades',
      entidadeTipo: 'oportunidade',
      ...metodos([
        'listarQuadros',
        'listarColunas',
        'listarCards',
        'resumoColuna',
        'acoesPermitidas',
        'mover',
        'criar',
      ]),
    };
    const entidade = {
      tipo: 'oportunidade',
      ...metodos(['descrever', 'rotaFicha', 'resolverVinculos']),
    };
    expect(() => assertModule({ ...base, quadros: [quadro], entidades: [entidade] })).not.toThrow();

    expect(() => assertModule({ ...base, quadros: quadro })).toThrow(/deve ser um array/);
    expect(() => assertModule({ ...base, quadros: [{ ...quadro, mover: undefined }] })).toThrow(
      /método `mover`/,
    );
    expect(() => assertModule({ ...base, quadros: [{ ...quadro, entidadeTipo: '' }] })).toThrow(
      /`entidadeTipo`/,
    );
    expect(() =>
      assertModule({ ...base, entidades: [{ ...entidade, descrever: undefined }] }),
    ).toThrow(/método `descrever`/);
  });

  it('todo módulo registrado passa no contrato e as flags não se repetem', () => {
    const modulos = MODULES.map(assertModule);
    const flags = modulos.flatMap((modulo) => modulo.featureFlags ?? []);
    expect(new Set(flags).size).toBe(flags.length);
  });
});
