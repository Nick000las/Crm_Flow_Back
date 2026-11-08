import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { reconciliarTenant } from '../services/reconcile.service.js';
import { hashDoToken } from '../services/token-formulario.service.js';

/**
 * FM2: link pessoal pela ficha. Tenant padrão com a flag `crm.formularios`.
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`. Sem FORMS_TOKEN_KEY no ambiente, usa uma chave de teste.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const BYTES_DA_CHAVE = 32;
const TOKEN_NA_URL = /\/f\/([A-Za-z0-9_-]{43})$/;
const CONFIG = '/crm/configuracoes/formularios';

rodar('link de formulário (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let app;
  let formulario;
  let campoNome;

  const tokenDe = () => app.jwt.access.sign({ tenantId, userId: donoId, role: 'DONO' });
  async function chamar(method, url, payload) {
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${tokenDe()}` },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;
    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
    return resposta.dados;
  };
  const novoLead = async () =>
    (
      await ok(
        chamar('POST', '/crm/leads', { nome: 'Pessoa', email: `${randomUUID()}@smoke.test` }),
        HTTP_STATUS.CREATED,
      )
    ).id;
  const copiar = (leadId, formId = formulario.id, body = {}) =>
    chamar('POST', `/crm/leads/${leadId}/formularios/${formId}/link`, body);
  const publicado = async (nome) => {
    const criado = await ok(chamar('POST', CONFIG, { nome }), HTTP_STATUS.CREATED);
    await ok(
      chamar('PUT', `${CONFIG}/${criado.id}`, {
        rascunho: { secoes: [{ itens: [{ campoId: campoNome }] }], termo: 'Aceito.' },
      }),
    );
    await ok(chamar('POST', `${CONFIG}/${criado.id}/publicar`), HTTP_STATUS.CREATED);
    return criado;
  };

  beforeAll(async () => {
    process.env.FORMS_TOKEN_KEY ??= randomBytes(BYTES_DA_CHAVE).toString('base64');
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE links',
        subdomain: `smoke-link-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });
    await prisma.usuario.create({
      data: {
        id: donoId,
        tenantId,
        nome: 'Dono',
        email: `${donoId}@smoke.test`,
        senhaHash: 'test',
        role: 'DONO',
      },
    });
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    app = await buildApp({
      config: {
        APP_NAME: 'crm-links',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    const elegiveis = await ok(chamar('GET', `${CONFIG}/campos-elegiveis`));
    campoNome = elegiveis.find((campo) => campo.chave === 'nome').id;
    formulario = await publicado('Anamnese');
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('aceite da FM2', () => {
    it('copiar duas vezes devolve o mesmo link', async () => {
      const leadId = await novoLead();
      const primeiro = await ok(copiar(leadId), HTTP_STATUS.CREATED);
      expect(primeiro).toMatchObject({ criado: true, link: { status: 'active' } });
      expect(primeiro.url).toMatch(TOKEN_NA_URL);

      const segundo = await ok(copiar(leadId));
      expect(segundo).toMatchObject({ criado: false, url: primeiro.url });
      expect(segundo.link.id).toBe(primeiro.link.id);
    });

    it('duas chamadas simultâneas geram um link só', async () => {
      const leadId = await novoLead();
      const respostas = await Promise.all([copiar(leadId), copiar(leadId), copiar(leadId)]);
      expect(new Set(respostas.map((r) => r.status))).toEqual(
        new Set([HTTP_STATUS.CREATED, HTTP_STATUS.OK]),
      );
      expect(new Set(respostas.map((r) => r.dados.url)).size).toBe(1);
      const [{ ativos }] = await prisma.$queryRaw`
        SELECT count(*)::int AS ativos FROM modulo_crm.crm_form_link
        WHERE lead_id = ${leadId}::uuid AND status = 'active'
      `;
      expect(ativos).toBe(1);
    });

    it('link revogado não volta: o próximo pedido gera outro', async () => {
      const leadId = await novoLead();
      const antigo = await ok(copiar(leadId), HTTP_STATUS.CREATED);
      await ok(chamar('POST', `/crm/leads/${leadId}/formularios/links/${antigo.link.id}/revogar`));

      const links = await ok(chamar('GET', `/crm/leads/${leadId}/formularios`));
      expect(links.find((link) => link.id === antigo.link.id)).toMatchObject({
        status: 'revoked',
        revogadoEm: expect.any(String),
      });
      const novo = await ok(copiar(leadId), HTTP_STATUS.CREATED);
      expect(novo.url).not.toBe(antigo.url);

      const deNovo = await chamar(
        'POST',
        `/crm/leads/${leadId}/formularios/links/${antigo.link.id}/revogar`,
      );
      expect(deNovo.status).toBe(HTTP_STATUS.CONFLICT);
    });
  });

  it('link vencido aparece como expired, e copiar gera outro', async () => {
    const leadId = await novoLead();
    const antigo = await ok(copiar(leadId), HTTP_STATUS.CREATED);
    await prisma.$executeRaw`
      UPDATE modulo_crm.crm_form_link SET expires_at = CURRENT_TIMESTAMP - interval '1 minute'
      WHERE id = ${antigo.link.id}::uuid
    `;
    const links = await ok(chamar('GET', `/crm/leads/${leadId}/formularios`));
    expect(links[0]).toMatchObject({ id: antigo.link.id, status: 'expired' });

    const novo = await ok(copiar(leadId), HTTP_STATUS.CREATED);
    expect(novo.link.id).not.toBe(antigo.link.id);
    const [{ status }] = await prisma.$queryRaw`
      SELECT status FROM modulo_crm.crm_form_link WHERE id = ${antigo.link.id}::uuid
    `;
    expect(status).toBe('expired');
  });

  it('o link fica na versão em que nasceu, mesmo com versão nova publicada', async () => {
    const leadId = await novoLead();
    const outro = await publicado(`Retorno ${randomUUID().slice(0, TAMANHO_SUFIXO)}`);
    const antes = await ok(copiar(leadId, outro.id), HTTP_STATUS.CREATED);
    expect(antes.link.versao.versao).toBe(1);

    await ok(chamar('POST', `${CONFIG}/${outro.id}/publicar`), HTTP_STATUS.CREATED);
    const depois = await ok(copiar(leadId, outro.id));
    expect(depois).toMatchObject({ url: antes.url, link: { versao: { versao: 1 } } });
  });

  it('o banco guarda só o hash e a cópia cifrada; o evento leva só ids', async () => {
    const leadId = await novoLead();
    const { url, link } = await ok(copiar(leadId), HTTP_STATUS.CREATED);
    const token = TOKEN_NA_URL.exec(url)[1];

    const [linha] = await prisma.$queryRaw`
      SELECT token_hash, token_encrypted FROM modulo_crm.crm_form_link WHERE id = ${link.id}::uuid
    `;
    expect(Buffer.compare(linha.token_hash, hashDoToken(token))).toBe(0);
    expect(linha.token_encrypted.includes(Buffer.from(token))).toBe(false);

    const eventos = await prisma.$queryRaw`
      SELECT tipo, entidade, payload FROM modulo_crm.crm_event
      WHERE tenant_id = ${tenantId}::uuid AND entidade_id = ${link.id}::uuid
    `;
    expect(eventos).toEqual([
      {
        tipo: 'form.link_created',
        entidade: 'form_link',
        payload: { formularioId: formulario.id, leadId },
      },
    ]);
  });

  describe('impedimentos', () => {
    it('formulário sem versão publicada ou inativo é 404', async () => {
      const leadId = await novoLead();
      const rascunho = await ok(
        chamar('POST', CONFIG, { nome: `Rascunho ${randomUUID().slice(0, TAMANHO_SUFIXO)}` }),
        HTTP_STATUS.CREATED,
      );
      expect((await copiar(leadId, rascunho.id)).status).toBe(HTTP_STATUS.NOT_FOUND);

      const inativo = await publicado(`Inativo ${randomUUID().slice(0, TAMANHO_SUFIXO)}`);
      await ok(chamar('PUT', `${CONFIG}/${inativo.id}`, { ativo: false }));
      expect((await copiar(leadId, inativo.id)).status).toBe(HTTP_STATUS.NOT_FOUND);

      const disponiveis = await ok(chamar('GET', '/crm/formularios/disponiveis'));
      const ids = disponiveis.map((item) => item.id);
      expect(ids).toContain(formulario.id);
      expect(ids).not.toContain(rascunho.id);
      expect(ids).not.toContain(inativo.id);
    });

    it('pessoa arquivada ou anonimizada é 409', async () => {
      const arquivada = await novoLead();
      await prisma.$executeRaw`
        UPDATE modulo_crm.leads SET archived_at = CURRENT_TIMESTAMP WHERE id = ${arquivada}::uuid
      `;
      expect((await copiar(arquivada)).status).toBe(HTTP_STATUS.CONFLICT);

      const anonimizada = await novoLead();
      await prisma.$executeRaw`
        UPDATE modulo_crm.leads SET anonimizado_em = CURRENT_TIMESTAMP WHERE id = ${anonimizada}::uuid
      `;
      expect((await copiar(anonimizada)).status).toBe(HTTP_STATUS.CONFLICT);
    });

    it('oportunidade de outra pessoa é 400', async () => {
      const leadId = await novoLead();
      const outra = await novoLead();
      const [deal] = await ok(chamar('GET', `/crm/leads/${outra}/oportunidades`));
      const resposta = await copiar(leadId, formulario.id, { oportunidadeId: deal.id });
      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);

      const [daPessoa] = await ok(chamar('GET', `/crm/leads/${leadId}/oportunidades`));
      const certo = await ok(
        copiar(leadId, formulario.id, { oportunidadeId: daPessoa.id }),
        HTTP_STATUS.CREATED,
      );
      expect(certo.link.oportunidadeId).toBe(daPessoa.id);
    });

    it('sem a chave no servidor: 503 e nada gravado', async () => {
      const leadId = await novoLead();
      const chave = process.env.FORMS_TOKEN_KEY;
      delete process.env.FORMS_TOKEN_KEY;
      try {
        const resposta = await copiar(leadId);
        expect(resposta.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
        expect(resposta.corpo.error.code).toBe('FORMS_UNAVAILABLE');
      } finally {
        process.env.FORMS_TOKEN_KEY = chave;
      }
      expect(await ok(chamar('GET', `/crm/leads/${leadId}/formularios`))).toEqual([]);
    });

    it('sem a flag, a ficha não envia', async () => {
      const leadId = await novoLead();
      await prisma.tenantModuleFeature.deleteMany({
        where: { tenantId, featureKey: CRM_FEATURES.FORMULARIOS },
      });
      await invalidarFeatures(tenantId);
      try {
        expect((await copiar(leadId)).status).toBe(HTTP_STATUS.FORBIDDEN);
      } finally {
        await prisma.tenantModuleFeature.create({
          data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
        });
        await invalidarFeatures(tenantId);
      }
    });
  });
});
