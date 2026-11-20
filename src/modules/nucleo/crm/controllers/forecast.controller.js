import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES } from '../constants.js';
import {
  dataPrevistaEmLoteBodySchema,
  forecastQuerySchema,
  oportunidadesDoForecastQuerySchema,
} from '../schemas/forecast.schema.js';
import {
  consultarForecast,
  definirDataPrevistaEmLote,
  listarOportunidadesDoForecast,
} from '../services/forecast.service.js';

/**
 * CONTROLLER: forecast (FC2). HTTP fino, atrás da flag `crm.forecast` e aberto a
 * todo papel: o que cada um vê sai das permissões de campo e da visibilidade
 * dos pipelines, no service.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasForecast(app) {
  const comFlag = { preHandler: [exigirFeature(CRM_FEATURES.FORECAST)] };

  app.get('/crm/forecast', comFlag, async (req, reply) => {
    const filtros = forecastQuerySchema.parse(req.query ?? {});
    return sendSuccess(reply, await consultarForecast(req.tenantContext, filtros));
  });

  app.get('/crm/forecast/oportunidades', comFlag, async (req, reply) => {
    const pedido = oportunidadesDoForecastQuerySchema.parse(req.query ?? {});
    return sendSuccess(reply, await listarOportunidadesDoForecast(req.tenantContext, pedido));
  });

  app.post('/crm/forecast/data-prevista', comFlag, async (req, reply) => {
    const dados = dataPrevistaEmLoteBodySchema.parse(req.body ?? {});
    return sendSuccess(reply, await definirDataPrevistaEmLote(req.tenantContext, dados));
  });
}
