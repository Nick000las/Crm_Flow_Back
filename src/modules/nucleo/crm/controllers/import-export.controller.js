import { requireRole } from '#core/auth/rbac.js';
import multipart from '@fastify/multipart';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendSuccess } from '#shared/http/response.js';
import { EXPORTACAO, IMPORTACAO, PAPEIS_GESTAO } from '../constants.js';
import {
  previsualizarImportacao,
  validarImportacao,
  confirmarImportacao,
  obterStatusImportacao,
  encerrarImportacao,
} from '../services/import.service.js';
import { exportarLeads } from '../services/export.service.js';
import {
  validarImportacaoCamposSchema,
  confirmarImportacaoBodySchema,
  importJobIdParamSchema,
  exportarLeadsBodySchema,
} from '../schemas/import-export.schema.js';

const EXTENSAO_XLSX = '.xlsx';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * Upload multipart só existe nestas rotas — o plugin é registrado aqui,
 * no escopo do módulo, não globalmente no app.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function registrarRotasImportExport(app) {
  const apenasGestao = { preHandler: requireRole(PAPEIS_GESTAO) };
  await app.register(multipart, {
    limits: { fileSize: IMPORTACAO.TAMANHO_MAXIMO_ARQUIVO_BYTES, files: 1 },
  });
  app.addHook('onClose', async () => encerrarImportacao());

  app.post('/crm/import/preview', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { arquivo } = await lerMultipart(req);
    return sendSuccess(reply, await previsualizarImportacao(tenantId, arquivo));
  });

  app.post('/crm/import/validate', apenasGestao, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { arquivo, campos } = await lerMultipart(req);
    const opcoes = validarImportacaoCamposSchema.parse(campos);
    return sendSuccess(reply, await validarImportacao(tenantId, userId, arquivo, opcoes));
  });

  app.post('/crm/import/:jobId/confirm', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { jobId } = importJobIdParamSchema.parse(req.params);
    const body = confirmarImportacaoBodySchema.parse(req.body ?? {});
    return sendSuccess(reply, await confirmarImportacao(tenantId, jobId, body));
  });

  app.get('/crm/import/:jobId', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { jobId } = importJobIdParamSchema.parse(req.params);
    return sendSuccess(reply, await obterStatusImportacao(tenantId, jobId));
  });

  app.post('/crm/export', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = exportarLeadsBodySchema.parse(req.body);
    const planilha = await exportarLeads(tenantId, body);
    return reply
      .header('Content-Type', EXPORTACAO.CONTENT_TYPE)
      .header('Content-Disposition', `attachment; filename="${EXPORTACAO.NOME_ARQUIVO}"`)
      .send(planilha);
  });
}

/**
 * Lê o multipart inteiro (arquivo + campos de texto em qualquer ordem).
 * O `toBuffer()` respeita o `fileSize` do plugin e lança 413 se passar.
 *
 * @param {import('fastify').FastifyRequest} req
 * @returns {Promise<{ arquivo: Buffer, campos: Record<string, string> }>}
 */
async function lerMultipart(req) {
  if (!req.isMultipart()) {
    throw erroDeArquivo('Envie a planilha como multipart/form-data (campo "arquivo")');
  }

  let arquivo = null;
  /** @type {Record<string, string>} */
  const campos = {};

  for await (const parte of req.parts()) {
    if (parte.type === 'file') {
      if (!parte.filename.toLowerCase().endsWith(EXTENSAO_XLSX)) {
        throw erroDeArquivo('Envie um arquivo .xlsx');
      }
      arquivo = await parte.toBuffer();
    } else {
      campos[parte.fieldname] = String(parte.value);
    }
  }

  if (!arquivo) {
    throw erroDeArquivo('Envie a planilha no campo "arquivo"');
  }
  return { arquivo, campos };
}

/** @param {string} mensagem */
function erroDeArquivo(mensagem) {
  return new AppError({
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: ERROR_CODES.VALIDATION_ERROR,
    message: mensagem,
    fields: { arquivo: [mensagem] },
  });
}
