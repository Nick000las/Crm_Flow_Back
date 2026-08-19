import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { assertModule } from '#core/types/module.js';
import { MODULES } from './modules.js';

/** @returns {Promise<import('fastify').FastifyInstance>} */
export async function buildApp() {
  const app = Fastify({ logger: true });

  // Sem `declare module` do TS, a propriedade precisa ser declarada em runtime
  // para o Fastify tratá-la como campo próprio da request (e não do prototype).
  app.decorateRequest('tenantContext', null);

  for (const candidato of MODULES) {
    const module = assertModule(candidato);
    app.log.info(`Registrando módulo: ${module.key} (${module.name})`);
    await module.registerRoutes(app);
  }

  app.get('/health', async () => ({ status: 'ok', modules: MODULES.map((m) => m.key) }));

  return app;
}

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

// Só sobe o servidor quando este arquivo é o processo principal — assim
// `buildApp()` pode ser importado por testes sem abrir porta.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
