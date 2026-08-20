import { pathToFileURL } from 'node:url';
import { buildApp } from '#api/app.js';
import { loadEnv } from '#core/config/env.js';

export { buildApp } from '#api/app.js';

async function main() {
  const config = loadEnv();
  const app = await buildApp({ config });

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'Encerrando servidor');
    await app.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
