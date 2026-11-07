import { PADRAO_UUID } from '../constants.js';
import {
  garantirOportunidadeVisivel,
  garantirPessoaVisivel,
} from '../services/visibilidade-pipeline.service.js';

/** Rota por id → conferência. Rota nova nesses caminhos entra sozinha. */
const CONFERENCIAS = Object.freeze([
  ['/crm/leads/:id', garantirPessoaVisivel],
  ['/crm/oportunidades/:id', garantirOportunidadeVisivel],
]);

/**
 * Visibilidade por pipeline (D4) num ponto só: pessoa ou oportunidade oculta dá
 * 404 em toda rota por id, como se não existisse. Id mal formado segue para o
 * handler, que responde 400.
 *
 * @param {import('fastify').FastifyRequest} req
 */
export async function exigirVisibilidade(req) {
  const rota = req.routeOptions?.url ?? '';
  const conferencia = CONFERENCIAS.find(
    ([prefixo]) => rota === prefixo || rota.startsWith(`${prefixo}/`),
  );
  const { id } = /** @type {{ id?: string }} */ (req.params ?? {});
  if (!conferencia || !id || !PADRAO_UUID.test(id)) return;

  const { tenantId, role } = req.tenantContext;
  await conferencia[1](tenantId, id, role);
}
