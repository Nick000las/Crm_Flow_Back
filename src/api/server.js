import { pathToFileURL } from 'node:url';
import { loadEnv } from '#core/config/env.js';
import { listenOptions } from './listen-options.js';

const ENTRY_SCRIPT_ARGUMENT_INDEX = 1;
const FAILURE_EXIT_CODE = 1;

async function main() {
  const config = loadEnv();
  // Import only after dotenv has been loaded and configuration validated.
  // The app imports Prisma clients at module evaluation time.
  const { buildApp } = await import('#api/app.js');
  const app = await buildApp({ config, logger: true });

  const shutdown = async () => {
    await app.close();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen(listenOptions(config));
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
