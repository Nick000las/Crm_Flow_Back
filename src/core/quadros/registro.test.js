import { beforeEach, describe, expect, it } from 'vitest';

import { registrarModulos } from '#core/registry/modules.js';

import {
  assertProvedoresValidos,
  provedorDaEntidade,
  provedorDoQuadro,
  provedoresDeQuadro,
} from './registro.js';

const QUADRO = { boardType: 'oportunidades', entidadeTipo: 'oportunidade' };
const ENTIDADE = { tipo: 'oportunidade' };
const modulo = (key, extras) => ({ key, name: key, registerRoutes() {}, ...extras });

describe('registro de provedores', () => {
  beforeEach(() => {
    registrarModulos([
      modulo('sem_provedor'),
      modulo('dono', { quadros: [QUADRO], entidades: [ENTIDADE] }),
    ]);
  });

  it('acha o provedor com o módulo dono', () => {
    expect(provedorDoQuadro('oportunidades')).toMatchObject({ ...QUADRO, modulo: 'dono' });
    expect(provedorDaEntidade('oportunidade')).toMatchObject({ ...ENTIDADE, modulo: 'dono' });
    expect(provedoresDeQuadro().map((quadro) => quadro.boardType)).toEqual(['oportunidades']);
  });

  it('sem provedor, devolve undefined: o quadro é nativo', () => {
    expect(provedorDoQuadro('projetos')).toBeUndefined();
    expect(provedorDaEntidade('pessoa')).toBeUndefined();
  });
});

describe('assertProvedoresValidos', () => {
  it('aceita módulos sem provedor e provedores completos', () => {
    expect(() =>
      assertProvedoresValidos([
        modulo('a'),
        modulo('dono', { quadros: [QUADRO], entidades: [ENTIDADE] }),
      ]),
    ).not.toThrow();
  });

  it('recusa boardType ou tipo repetidos, mesmo em módulos diferentes', () => {
    expect(() =>
      assertProvedoresValidos([
        modulo('a', { quadros: [QUADRO], entidades: [ENTIDADE] }),
        modulo('b', { quadros: [QUADRO] }),
      ]),
    ).toThrow(/quadro duplicado: "oportunidades"/);

    expect(() =>
      assertProvedoresValidos([
        modulo('a', { entidades: [ENTIDADE] }),
        modulo('b', { entidades: [ENTIDADE] }),
      ]),
    ).toThrow(/entidade duplicado: "oportunidade"/);
  });

  it('recusa quadro cuja entidade não tem provedor', () => {
    expect(() => assertProvedoresValidos([modulo('a', { quadros: [QUADRO] })])).toThrow(
      /sem provedor registrado/,
    );
  });
});
