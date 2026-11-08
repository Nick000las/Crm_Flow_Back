import { describe, expect, it } from 'vitest';
import { urlParaLog } from './app.js';

describe('urlParaLog', () => {
  it('rota pública guarda só o recurso: o resto pode ser segredo', () => {
    expect(urlParaLog('/public/f/AbC123_-tokenSecreto')).toBe('/public/f/[oculto]');
    expect(urlParaLog('/public/f/AbC123/aberto?x=1')).toBe('/public/f/[oculto]');
    expect(urlParaLog('/public/f')).toBe('/public/f');
  });

  it('as outras rotas saem como vieram', () => {
    expect(urlParaLog('/crm/leads?busca=ana')).toBe('/crm/leads?busca=ana');
    expect(urlParaLog('/publicar')).toBe('/publicar');
  });
});
