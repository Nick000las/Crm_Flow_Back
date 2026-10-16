import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * Registro dos módulos em tempo de execução. O `core` não pode importar
 * `#api/modules.js` (regra de fronteira: core só depende de core/shared) —
 * quem sobe o processo entrega a lista aqui:
 *
 * - servidor HTTP: `buildApp` (`#api/app.js`), depois do `assertModule`;
 * - scripts que provisionam tenant (`scripts/create-tenant.js`);
 * - testes que exercitam o core com os módulos reais.
 *
 * Usar o core sem registrar é erro de programação — falha alto em vez de
 * tratar a lista como vazia (todo `moduleKey` viraria "inválido").
 */

/** @type {readonly import('#core/types/module.js').Module[] | null} */
let registrados = null;

/** @param {import('#core/types/module.js').Module[]} modulos */
export function registrarModulos(modulos) {
  registrados = Object.freeze([...modulos]);
}

/** @returns {readonly import('#core/types/module.js').Module[]} */
export function modulosRegistrados() {
  if (!registrados) {
    throw new Error('Módulos não registrados: chame registrarModulos(MODULES) ao subir o processo.');
  }
  return registrados;
}

/**
 * 400 com o campo `modulosContratados` se alguma chave não for de um
 * módulo registrado — usado na criação do tenant e na troca de módulos.
 *
 * @param {string[]} moduleKeys
 */
export function validarModuleKeys(moduleKeys) {
  const chaves = new Set(modulosRegistrados().map((modulo) => modulo.key));
  for (const moduleKey of moduleKeys) {
    if (!moduleKey || typeof moduleKey !== 'string' || !chaves.has(moduleKey)) {
      throw new AppError({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Module key inválido: ${moduleKey}`,
        fields: { modulosContratados: [`"${moduleKey}" não é um módulo válido`] },
      });
    }
  }
}
