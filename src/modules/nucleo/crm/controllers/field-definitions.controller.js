import { sendSuccess } from '#shared/http/response.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
    listarDefinicoesPorTenant as listarDefinicoesPorTenantService,
    criarNovaDefinicao as criarDefinicaoService,
    editarDefinicao as editarDefinicaoService,
    reordenarDefinicoesDoTenant as reordenarDefinicaoService,
    removerDefinicao as removerDefinicaoService
} from '../services/field-definitions.service.js'
import {
    criarDefinicaoBodySchema,
    editarDefinicaoBodySchema,
    definicaoIdParamSchema,
    reordenarDefinicoesBodySchema,
} from '../schemas/field-definitions.schema.js'

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasDefinicoes(app){

    app.get('/crm/field-definitions', async (req, reply) => {
        const { tenantId } = req.tenantContext;
        return sendSuccess(reply, await listarDefinicoesPorTenantService(tenantId));
    })
    app.post('/crm/field-definitions', async (req, reply) => {
        const { tenantId } = req.tenantContext;
        const body = criarDefinicaoBodySchema.parse(req.body);
        const data = await criarDefinicaoService(tenantId, body);
        return sendSuccess(reply, data, HTTP_STATUS.CREATED);
    })
    // PUT antes de POST/GET importa pouco pro Fastify (find-my-way resolve
    // rota estática (`/reorder`) x parametrizada (`/:id`) sozinho, na ordem
    // que for registrada) — mas cada handler só pode confiar no schema que
    // é dele.
    app.put('/crm/field-definitions/reorder', async (req, reply) => {
        const { tenantId } = req.tenantContext;
        const definicoesOrdenadas = reordenarDefinicoesBodySchema.parse(req.body);
        return sendSuccess(reply, await reordenarDefinicaoService(tenantId, definicoesOrdenadas));
    })
    app.put('/crm/field-definitions/:id', async (req, reply) => {
        const { tenantId } = req.tenantContext;
        const { id: definicaoId } = definicaoIdParamSchema.parse(req.params);
        const atualizacoes = editarDefinicaoBodySchema.parse(req.body);
        return sendSuccess(reply, await editarDefinicaoService(tenantId, definicaoId, atualizacoes));
    })
    app.delete('/crm/field-definitions/:id', async (req, reply) => {
        const { tenantId } = req.tenantContext;
        const { id: definicaoId } = definicaoIdParamSchema.parse(req.params);
        return sendSuccess(reply, await removerDefinicaoService(tenantId, definicaoId));
    })
}