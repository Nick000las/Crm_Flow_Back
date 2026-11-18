/** @file Registra regras locais de responsabilidade, documentação e SQL parametrizado. */
import filePurpose from './file-purpose.js';
import importsFirst from './imports-first.js';
import layers from './layers.js';
import sqlFormat from './sql-format.js';

export default {
  rules: {
    'file-purpose': filePurpose,
    'imports-first': importsFirst,
    layers,
    'sql-format': sqlFormat,
  },
};
