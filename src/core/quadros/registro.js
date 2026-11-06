import { modulosRegistrados } from '#core/registry/modules.js';

/**
 * Provedores de quadro e de entidade: como um módulo publica conteúdo no
 * motor do Kanban sem que um importe o outro. O Kanban conhece só `boardType`,
 * `tipo` e ids; o módulo dono dos dados implementa os contratos declarados em
 * `Module.quadros` e `Module.entidades` (`#core/types/module.js`).
 *
 * @typedef {import('#core/types/module.js').ProvedorDeQuadro} ProvedorDeQuadro
 * @typedef {import('#core/types/module.js').ProvedorDeEntidade} ProvedorDeEntidade
 */

/**
 * @template T
 * @param {'quadros' | 'entidades'} contrato
 * @returns {(T & { modulo: string })[]} cada provedor com a `key` do módulo dono
 */
function provedores(contrato) {
  return modulosRegistrados().flatMap((modulo) =>
    (modulo[contrato] ?? []).map((provedor) => ({ ...provedor, modulo: modulo.key })),
  );
}

/** @returns {(ProvedorDeQuadro & { modulo: string })[]} */
export function provedoresDeQuadro() {
  return provedores('quadros');
}

/**
 * @param {string} boardType
 * @returns {(ProvedorDeQuadro & { modulo: string }) | undefined} sem provedor, o quadro é nativo
 */
export function provedorDoQuadro(boardType) {
  return provedoresDeQuadro().find((provedor) => provedor.boardType === boardType);
}

/** @returns {(ProvedorDeEntidade & { modulo: string })[]} */
export function provedoresDeEntidade() {
  return provedores('entidades');
}

/**
 * @param {string} tipo
 * @returns {(ProvedorDeEntidade & { modulo: string }) | undefined}
 */
export function provedorDaEntidade(tipo) {
  return provedoresDeEntidade().find((provedor) => provedor.tipo === tipo);
}

/** @param {string[]} valores */
function primeiroRepetido(valores) {
  return valores.find((valor, indice) => valores.indexOf(valor) !== indice);
}

/**
 * Regras que olham todos os módulos juntos, conferidas ao subir: tipo
 * repetido deixaria um provedor inalcançável, e quadro sem provedor da sua
 * entidade só falharia na primeira requisição.
 *
 * @param {import('#core/types/module.js').Module[]} modulos
 */
export function assertProvedoresValidos(modulos) {
  const quadros = modulos.flatMap((modulo) => modulo.quadros ?? []);
  const entidades = modulos.flatMap((modulo) => modulo.entidades ?? []);

  const boardTypeRepetido = primeiroRepetido(quadros.map((quadro) => quadro.boardType));
  if (boardTypeRepetido) {
    throw new Error(`Provedor de quadro duplicado: "${boardTypeRepetido}".`);
  }
  const tipoRepetido = primeiroRepetido(entidades.map((entidade) => entidade.tipo));
  if (tipoRepetido) {
    throw new Error(`Provedor de entidade duplicado: "${tipoRepetido}".`);
  }

  const tipos = new Set(entidades.map((entidade) => entidade.tipo));
  const semEntidade = quadros.find((quadro) => !tipos.has(quadro.entidadeTipo));
  if (semEntidade) {
    throw new Error(
      `Quadro "${semEntidade.boardType}" usa a entidade "${semEntidade.entidadeTipo}", sem provedor registrado.`,
    );
  }
}
