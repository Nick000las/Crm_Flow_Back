/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ appName: string, modules: string[] }} options
 */
export function registerHealthRoutes(app, options) {
  app.get('/health', async () => ({
    status: 'ok',
    service: options.appName,
    modules: options.modules,
    uptimeSeconds: Math.floor(process.uptime()),
  }));
}
