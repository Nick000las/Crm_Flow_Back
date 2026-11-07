import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `constants.js` reexporta tudo com `export *`. Nome repetido entre dois arquivos
 * faz o Node recusar o import ao subir, mas o vitest não acusa: o erro só
 * apareceria em produção.
 */
describe('constants do CRM', () => {
  it('nenhum nome é exportado por dois arquivos', async () => {
    const pasta = fileURLToPath(new URL('.', import.meta.url));
    const arquivos = readdirSync(pasta).filter(
      (nome) => nome.endsWith('.js') && !nome.endsWith('.test.js'),
    );
    /** @type {Map<string, string>} */
    const donos = new Map();
    const repetidos = [];

    for (const arquivo of arquivos) {
      const modulo = await import(`./${arquivo}`);
      for (const nome of Object.keys(modulo)) {
        if (donos.has(nome)) repetidos.push(`${nome}: ${donos.get(nome)} e ${arquivo}`);
        donos.set(nome, arquivo);
      }
    }

    expect(repetidos).toEqual([]);
  });
});
