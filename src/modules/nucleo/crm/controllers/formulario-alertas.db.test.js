import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { CRM_FEATURES, MODULO_CRM, SELOS_DO_CARD, TEXTO_ALERTA_GENERICO } from '../constants.js';
import { atualizarConfiguracaoCampo } from '../services/configuracoes-campos.service.js';
import { criarNovaDefinicao } from '../services/field-definitions.service.js';
import { invalidarSchemaCampos } from '../services/field-schema.service.js';
import { provedorDeOportunidade } from '../services/quadro-comercial.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FM5: alertas do formulário. Tenant padrão com `crm.formularios`; o campo
 * Alergias é sensível. GRAVA no banco de `DATABASE_URL` (tenant SMOKE,
 * apagado no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const BYTES_DA_CHAVE = 32;
const ORDEM = 95;
const DOIS_ALERTAS = 2;
const TOKEN_NA_URL = /\/f\/([A-Za-z0-9_-]{43})$/;
const CONFIG = '/crm/configuracoes/formularios';
const PUBLICO = '/public/f';

rodar('alertas do formulário (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let formulario;
  let versao;
  let alergias;
  let campoNome;
  let perguntas;
  let ipDaVez = 0;

  const usuarioDe = (papel) => (papel === 'OPERADOR' ? operadorId : donoId);

  async function chamar(method, url, payload, papel = 'DONO') {
    const token = app.jwt.access.sign({ tenantId, userId: usuarioDe(papel), role: papel });
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;

    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }

  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;

    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);

    return resposta.dados;
  };

  async function enviar(token, respostas) {
    ipDaVez += 1;

    const resposta = await app.inject({
      method: 'POST',
      url: `${PUBLICO}/${token}/respostas`,
      payload: { respostas, aceite: true, preenchidoPor: 'titular' },
      remoteAddress: `10.5.0.${ipDaVez}`,
    });

    expect(resposta.statusCode, resposta.body).toBe(HTTP_STATUS.CREATED);
  }

  async function pessoaComLink() {
    const lead = await ok(
      chamar('POST', '/crm/leads', { nome: 'Rita Lima', email: `${randomUUID()}@smoke.test` }),
      HTTP_STATUS.CREATED,
    );
    const link = await ok(
      chamar('POST', `/crm/leads/${lead.id}/formularios/${formulario.id}/link`, {}),
      HTTP_STATUS.CREATED,
    );
    const [, token] = link.url.match(TOKEN_NA_URL);

    return { leadId: lead.id, token };
  }

  async function pessoaRespondendo(respostas) {
    const { leadId, token } = await pessoaComLink();

    await enviar(token, { [campoNome]: 'Rita Lima', ...respostas });

    return leadId;
  }

  const eventosDaPessoa = async (leadId) => {
    const [{ n }] = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM modulo_crm.crm_event
      WHERE tenant_id = ${tenantId}::uuid AND entidade = 'person'
        AND entidade_id = ${leadId}::uuid AND tipo = 'person.updated'
    `;

    return n;
  };
  const alertasDe = (leadId, papel = 'DONO', query = '') =>
    ok(chamar('GET', `/crm/leads/${leadId}/formularios/alertas${query}`, undefined, papel));

  async function seloDoCard(leadId, papel = 'DONO') {
    const [deal] = await prisma.$queryRaw`
      SELECT id::text FROM modulo_crm.crm_deal WHERE lead_id = ${leadId}::uuid
    `;
    const [card] = await provedorDeOportunidade.descrever(
      { tenantId, userId: usuarioDe(papel), role: papel },
      [deal.id],
    );

    return card.selos.find((selo) => selo.tipo === SELOS_DO_CARD.ALERTA) ?? null;
  }

  beforeAll(async () => {
    process.env.FORMS_TOKEN_KEY ??= randomBytes(BYTES_DA_CHAVE).toString('base64');

    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE alertas',
        subdomain: `smoke-alerta-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });

    await prisma.usuario.createMany({
      data: [
        { id: donoId, role: 'DONO' },
        { id: operadorId, role: 'OPERADOR' },
      ].map(({ id, role }) => ({
        id,
        tenantId,
        nome: 'Usuário',
        email: `${id}@smoke.test`,
        senhaHash: 'test',
        role,
      })),
    });

    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });

    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
    });

    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    alergias = await criarNovaDefinicao(tenantId, {
      label: 'Alergias',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });

    await atualizarConfiguracaoCampo(tenantId, alergias.id, { sensivel: true });
    await invalidarSchemaCampos(tenantId);

    app = await buildApp({
      config: {
        APP_NAME: 'crm-formulario-alertas',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });

    const elegiveis = await ok(chamar('GET', `${CONFIG}/campos-elegiveis`));

    campoNome = elegiveis.find((campo) => campo.chave === 'nome').id;
    formulario = await ok(chamar('POST', CONFIG, { nome: 'Anamnese' }), HTTP_STATUS.CREATED);

    // Pergunta nova ganha o id ao salvar; o alerta sobre ela vem depois.
    const salvo = await ok(
      chamar('PUT', `${CONFIG}/${formulario.id}`, {
        rascunho: {
          secoes: [
            {
              itens: [
                { campoId: campoNome, obrigatorio: true },
                { campoId: alergias.id },
                { pergunta: { rotulo: 'Fuma?', tipo: 'booleano', sensivel: true } },
                { pergunta: { rotulo: 'Dor', tipo: 'selecao', opcoes: ['Leve', 'Forte'] } },
              ],
            },
          ],
          termo: 'Aceito.',
        },
      }),
    );
    const itens = salvo.rascunho.secoes[0].itens;

    perguntas = { fuma: itens[2].pergunta.id, dor: itens[3].pergunta.id };

    await ok(
      chamar('PUT', `${CONFIG}/${formulario.id}`, {
        rascunho: {
          ...salvo.rascunho,
          alertas: [
            {
              alvo: { campoId: alergias.id },
              operador: 'contem',
              valor: 'dipirona',
              nivel: 'critical',
              texto: 'Alergia a dipirona',
            },
            {
              alvo: { perguntaId: perguntas.fuma },
              operador: 'igual',
              valor: true,
              nivel: 'warning',
              texto: 'Fumante',
            },
            {
              alvo: { perguntaId: perguntas.dor },
              operador: 'igual',
              valor: 'Forte',
              nivel: 'info',
              texto: 'Dor forte',
            },
          ],
        },
      }),
    );

    versao = await ok(chamar('POST', `${CONFIG}/${formulario.id}/publicar`), HTTP_STATUS.CREATED);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  it('a versão publicada leva os alertas, e a relida é igual', async () => {
    expect(versao.alertas.map((alerta) => alerta.texto)).toEqual([
      'Alergia a dipirona',
      'Fumante',
      'Dor forte',
    ]);

    const relida = await ok(chamar('GET', `${CONFIG}/${formulario.id}/versoes/${versao.id}`));

    expect(relida.alertas).toEqual(versao.alertas);

    expect((await ok(chamar('GET', `${CONFIG}/${formulario.id}`))).alteracoesNaoPublicadas).toBe(
      false,
    );
  });

  it('alerta sobre item que saiu do rascunho é 400', async () => {
    const atual = await ok(chamar('GET', `${CONFIG}/${formulario.id}`));
    const semAlergias = atual.rascunho.secoes[0].itens.filter(
      (item) => item.campoId !== alergias.id,
    );
    const resposta = await chamar('PUT', `${CONFIG}/${formulario.id}`, {
      rascunho: { ...atual.rascunho, secoes: [{ titulo: null, itens: semAlergias }] },
    });

    expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(resposta.corpo.error.fields).toHaveProperty(['rascunho.alertas.0.alvo']);
  });

  it('a resposta que casa gera alertas, e o card da pessoa é avisado', async () => {
    const leadId = await pessoaRespondendo({
      [alergias.id]: 'Dipirona e AAS',
      [perguntas.fuma]: true,
      [perguntas.dor]: 'Leve',
    });
    const alertas = await alertasDe(leadId);

    expect(alertas.map((alerta) => [alerta.nivel, alerta.texto, alerta.generico])).toEqual([
      ['critical', 'Alergia a dipirona', false],
      ['warning', 'Fumante', false],
    ]);

    expect(alertas[0].formulario).toEqual({ id: formulario.id, nome: 'Anamnese' });
  });

  it('o alerta avisa o card mesmo quando a resposta não grava campo', async () => {
    const { leadId, token } = await pessoaComLink();
    const antes = await eventosDaPessoa(leadId);

    // Nome igual e só perguntas: nenhuma edição do lead, só o alerta.
    await enviar(token, { [campoNome]: 'Rita Lima', [perguntas.fuma]: true });
    expect(await eventosDaPessoa(leadId)).toBe(antes + 1);
    expect(await seloDoCard(leadId)).toEqual({ tipo: SELOS_DO_CARD.ALERTA, nivel: 'warning' });
  });

  it('a resposta que não casa não gera alerta', async () => {
    const leadId = await pessoaRespondendo({ [perguntas.fuma]: false });

    expect(await alertasDe(leadId)).toEqual([]);
    expect(await seloDoCard(leadId)).toBeNull();
  });

  it('aceite: OPERADOR sem acesso ao sensível vê o alerta genérico e não vê as respostas', async () => {
    const leadId = await pessoaRespondendo({
      [alergias.id]: 'Dipirona',
      [perguntas.fuma]: true,
      [perguntas.dor]: 'Forte',
    });
    const doOperador = await alertasDe(leadId, 'OPERADOR');

    expect(doOperador.map((alerta) => [alerta.nivel, alerta.generico])).toEqual([
      ['critical', true],
      ['warning', true],
      ['info', false],
    ]);

    expect(doOperador[0].texto).toBe(TEXTO_ALERTA_GENERICO);
    expect(doOperador[2].texto).toBe('Dor forte');

    const textoDosAlertas = JSON.stringify(doOperador);

    expect(textoDosAlertas).not.toMatch(/dipirona|Fumante/i);

    const [resumo] = await ok(
      chamar('GET', `/crm/leads/${leadId}/formularios/respostas`, undefined, 'OPERADOR'),
    );
    const resposta = await ok(
      chamar(
        'GET',
        `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`,
        undefined,
        'OPERADOR',
      ),
    );

    expect(JSON.stringify(resposta)).not.toMatch(/dipirona/i);

    const fuma = resposta.secoes[0].itens.find((item) => item.pergunta?.id === perguntas.fuma);

    expect(fuma).toMatchObject({ oculto: true });
  });

  it('visto é por usuário, e o selo do card segue quem vê', async () => {
    const leadId = await pessoaRespondendo({
      [alergias.id]: 'Dipirona',
      [perguntas.fuma]: true,
    });

    expect(await seloDoCard(leadId)).toEqual({ tipo: SELOS_DO_CARD.ALERTA, nivel: 'critical' });

    expect(await seloDoCard(leadId, 'OPERADOR')).toEqual({
      tipo: SELOS_DO_CARD.ALERTA,
      nivel: 'critical',
    });

    const [critico, atencao] = await alertasDe(leadId);

    await ok(chamar('POST', `/crm/leads/${leadId}/formularios/alertas/${critico.id}/visto`));
    // Repetir não muda nada.
    await ok(chamar('POST', `/crm/leads/${leadId}/formularios/alertas/${critico.id}/visto`));
    expect((await alertasDe(leadId)).map((alerta) => alerta.id)).toEqual([atencao.id]);
    expect(await seloDoCard(leadId)).toEqual({ tipo: SELOS_DO_CARD.ALERTA, nivel: 'warning' });
    expect(await alertasDe(leadId, 'OPERADOR')).toHaveLength(DOIS_ALERTAS);

    const todos = await alertasDe(leadId, 'DONO', '?todos=true');

    expect(todos.find((alerta) => alerta.id === critico.id).vistoEm).not.toBeNull();

    await ok(chamar('POST', `/crm/leads/${leadId}/formularios/alertas/${atencao.id}/visto`));
    expect(await seloDoCard(leadId)).toBeNull();
    expect((await seloDoCard(leadId, 'OPERADOR'))?.nivel).toBe('critical');

    const deOutra = await chamar(
      'POST',
      `/crm/leads/${leadId}/formularios/alertas/${randomUUID()}/visto`,
    );

    expect(deOutra.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('sem a flag, o card não mostra o selo', async () => {
    const leadId = await pessoaRespondendo({ [alergias.id]: 'Dipirona' });

    expect(await seloDoCard(leadId)).not.toBeNull();

    await prisma.tenantModuleFeature.deleteMany({
      where: { tenantId, featureKey: CRM_FEATURES.FORMULARIOS },
    });

    await invalidarFeatures(tenantId);

    try {
      expect(await seloDoCard(leadId)).toBeNull();
    } finally {
      await prisma.tenantModuleFeature.create({
        data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
      });

      await invalidarFeatures(tenantId);
    }
  });
});
