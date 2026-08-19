import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Como este repositório NÃO publica cada módulo como pacote separado, não existe
 * "migration que vem dentro do pacote instalado" (cenário multi-repo). Em vez disso,
 * este script varre `src/modules/**\/prisma/schema.prisma.part` e concatena tudo num
 * único arquivo SQL, aplicado via `prisma db execute` depois do `prisma migrate dev`
 * cuidar das tabelas do core (que são modeladas via Prisma normalmente).
 *
 * Rodar via `npm run db:build-schema` (chamado automaticamente por `npm run db:migrate`).
 */

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = join(ROOT_DIR, 'src', 'modules');
const OUTPUT_PATH = join(ROOT_DIR, 'prisma', 'modules-schema.generated.sql');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function encontrarSchemaParts(dir) {
  /** @type {string[]} */
  const partes = [];
  for (const categoria of readdirSync(dir, { withFileTypes: true })) {
    if (!categoria.isDirectory()) continue;
    const categoriaPath = join(dir, categoria.name);
    for (const modulo of readdirSync(categoriaPath, { withFileTypes: true })) {
      if (!modulo.isDirectory()) continue;
      const partPath = join(categoriaPath, modulo.name, 'prisma', 'schema.prisma.part');
      if (existsSync(partPath)) partes.push(partPath);
    }
  }
  return partes;
}

function main() {
  const partes = encontrarSchemaParts(MODULES_DIR);

  if (partes.length === 0) {
    console.log('Nenhum schema.prisma.part encontrado.');
    return;
  }

  const conteudo = partes
    .map((p) => `-- ===== ${p.replace(ROOT_DIR, '')} =====\n${readFileSync(p, 'utf-8')}`)
    .join('\n\n');

  mkdirSync(join(ROOT_DIR, 'prisma'), { recursive: true });
  writeFileSync(OUTPUT_PATH, conteudo);

  console.log(`Schema combinado gerado a partir de ${partes.length} módulo(s):`);
  partes.forEach((p) => console.log(`  - ${p}`));
  console.log(`\nSaída: ${OUTPUT_PATH}`);
  console.log('\nPróximo passo: npm run db:apply-modules');
}

main();
