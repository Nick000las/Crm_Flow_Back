import { pathToFileURL } from 'node:url';
import { buildApp } from '#api/app.js';
import { loadEnv } from '#core/config/env.js';

const ENTRY_SCRIPT_ARGUMENT_INDEX = 1;
const FAILURE_EXIT_CODE = 1;

export { buildApp } from '#api/app.js';

async function main() {
  const config = loadEnv();
  const app = await buildApp({ config });

  const shutdown = async () => {
    await app.close();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ port: config.PORT, host: config.HOST });
}

if (
  process.argv[ENTRY_SCRIPT_ARGUMENT_INDEX] &&
  import.meta.url === pathToFileURL(process.argv[ENTRY_SCRIPT_ARGUMENT_INDEX]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exit(FAILURE_EXIT_CODE);
  });
}
