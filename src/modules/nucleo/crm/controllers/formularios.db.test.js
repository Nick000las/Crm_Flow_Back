import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { criarNovaDefinicao } from '../services/field-definitions.service.js';
import { invalidarSchemaCampos } from '../services/field-schema.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FM1: formulário e versões pelas rotas de Configurações, no tenant padrão
 * (só a flag `crm.formularios` ligada). GRAVA no banco de `DATABASE_URL`
 * (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const ORDEM = 70;
const BASE = '/crm/configuracoes/formularios';
const PRIMEIRA = 1;
const SEGUNDA = 2;

rodar('formulários (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let elegiveis;

  const tokenDe = (papel = 'DONO', userId = donoId) =>
    app.jwt.access.sign({ tenantId, userId, role: papel });
  async function chamar(method, url, payload, papel) {
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: {
        authorization: `Bearer ${tokenDe(papel, papel === 'OPERADOR' ? operadorId : donoId)}`,
      },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;
    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
    return resposta.dados;
  };
  const idDe = (chave) => elegiveis.find((campo) => campo.chave === chave).id;
  const novoFormulario = (nome = `Anamnese ${randomUUID().slice(0, TAMANHO_SUFIXO)}`) =>
    ok(chamar('POST', BASE, { nome }), HTTP_STATUS.CREATED);
  const salvarRascunho = (id, rascunho) => ok(chamar('PUT', `${BASE}/${id}`, { rascunho }));

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE formularios',
        subdomain: `smoke-form-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
    await criarNovaDefinicao(tenantId, {
      label: 'Alergias',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });
    app = await buildApp({
      config: {
        APP_NAME: 'crm-formularios',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    elegiveis = await ok(chamar('GET', `${BASE}/campos-elegiveis`));
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  it('campos elegíveis: os da pessoa ligados no CRM, sem os comerciais nem os do sistema', () => {
    const chaves = elegiveis.map((campo) => campo.chave);
    expect(chaves).toEqual(expect.arrayContaining(['nome', 'email', 'telefone', 'alergias']));
    for (const fora of ['status', 'valor', 'tags', 'fonteLead', 'motivoPerda', 'leadScore']) {
      expect(chaves).not.toContain(fora);
    }
    // Camada 2 desligada por padrão (ex.: CPF) não entra até o dono ligar.
    expect(chaves).not.toContain('cpf');
  });

  describe('aceite da FM1', () => {
    it('editar um formulário publicado gera versão nova, e a anterior não muda', async () => {
      const formulario = await novoFormulario();
      expect(formulario).toMatchObject({ versaoAtual: null, alteracoesNaoPublicadas: true });

      await salvarRascunho(formulario.id, {
        secoes: [{ titulo: 'Contato', itens: [{ campoId: idDe('nome'), obrigatorio: true }] }],
        termo: 'Autorizo o uso dos meus dados para o atendimento.',
      });
      const v1 = await ok(chamar('POST', `${BASE}/${formulario.id}/publicar`), HTTP_STATUS.CREATED);
      expect(v1).toMatchObject({ versao: 1, publicadaPor: donoId });
      expect(v1.secoes[0].itens[0]).toMatchObject({
        obrigatorio: true,
        politica: 'overwrite',
        campo: { chave: 'nome', label: 'Nome' },
      });
      expect(await ok(chamar('GET', `${BASE}/${formulario.id}`))).toMatchObject({
        versaoAtual: { id: v1.id, versao: 1 },
        alteracoesNaoPublicadas: false,
      });

      // Renomear o campo e mudar o rascunho não mexe na versão 1.
      const alergias = idDe('alergias');
      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_field SET label = 'Alergias conhecidas'
        WHERE tenant_id = ${tenantId}::uuid AND id = ${alergias}::uuid
      `;
      await invalidarSchemaCampos(tenantId);
      await salvarRascunho(formulario.id, {
        secoes: [{ titulo: 'Saúde', itens: [{ campoId: alergias }] }],
        termo: 'Autorizo o uso dos meus dados de saúde para o atendimento.',
      });
      const detalhe = await ok(chamar('GET', `${BASE}/${formulario.id}`));
      expect(detalhe.alteracoesNaoPublicadas).toBe(true);

      const v2 = await ok(chamar('POST', `${BASE}/${formulario.id}/publicar`), HTTP_STATUS.CREATED);
      expect(v2.versao).toBe(SEGUNDA);
      const v1Depois = await ok(chamar('GET', `${BASE}/${formulario.id}/versoes/${v1.id}`));
      expect(v1Depois).toEqual(v1);
      expect(
        (await ok(chamar('GET', `${BASE}/${formulario.id}`))).versoes.map((v) => v.versao),
      ).toEqual([SEGUNDA, PRIMEIRA]);
    });
  });

  it('o banco recusa alterar uma versão publicada', async () => {
    const formulario = await novoFormulario();
    await salvarRascunho(formulario.id, {
      secoes: [{ itens: [{ campoId: idDe('nome') }] }],
      termo: 'Aceito.',
    });
    const versao = await ok(
      chamar('POST', `${BASE}/${formulario.id}/publicar`),
      HTTP_STATUS.CREATED,
    );
    await expect(
      prisma.$executeRaw`
        UPDATE modulo_crm.crm_form_version SET consent_text = 'outro' WHERE id = ${versao.id}::uuid
      `,
    ).rejects.toThrow(/imutável/);
  });

  it('duas publicações ao mesmo tempo geram versões distintas', async () => {
    const formulario = await novoFormulario();
    await salvarRascunho(formulario.id, {
      secoes: [{ itens: [{ campoId: idDe('email') }] }],
      termo: 'Aceito.',
    });
    const [a, b] = await Promise.all([
      chamar('POST', `${BASE}/${formulario.id}/publicar`),
      chamar('POST', `${BASE}/${formulario.id}/publicar`),
    ]);
    expect([a.status, b.status]).toEqual([HTTP_STATUS.CREATED, HTTP_STATUS.CREATED]);
    expect([a.dados.versao, b.dados.versao].sort()).toEqual([PRIMEIRA, SEGUNDA]);
  });

  describe('validação', () => {
    it('campo comercial ou desconhecido no rascunho é 400 no item', async () => {
      const formulario = await novoFormulario();
      const resposta = await chamar('PUT', `${BASE}/${formulario.id}`, {
        rascunho: { secoes: [{ itens: [{ campoId: randomUUID() }] }] },
      });
      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(resposta.corpo.error.fields).toHaveProperty(['rascunho.secoes.0.itens.0.campoId']);
    });

    it('publicar sem campo ou sem termo é 400', async () => {
      const formulario = await novoFormulario();
      const resposta = await chamar('POST', `${BASE}/${formulario.id}/publicar`);
      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(Object.keys(resposta.corpo.error.fields).sort()).toEqual([
        'rascunho.secoes',
        'rascunho.termo',
      ]);
    });

    it('campo desligado depois de salvo bloqueia a publicação', async () => {
      const formulario = await novoFormulario();
      const telefone = idDe('telefone');
      await salvarRascunho(formulario.id, {
        secoes: [{ itens: [{ campoId: telefone }] }],
        termo: 'Aceito.',
      });
      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_field_visibility SET visible = false
        WHERE tenant_id = ${tenantId}::uuid AND field_id = ${telefone}::uuid
      `;
      await invalidarSchemaCampos(tenantId);
      try {
        const resposta = await chamar('POST', `${BASE}/${formulario.id}/publicar`);
        expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      } finally {
        await prisma.$executeRaw`
          UPDATE modulo_crm.crm_field_visibility SET visible = true
          WHERE tenant_id = ${tenantId}::uuid AND field_id = ${telefone}::uuid
        `;
        await invalidarSchemaCampos(tenantId);
      }
    });

    it('desativar e reativar mantém rascunho e versões', async () => {
      const formulario = await novoFormulario();
      await salvarRascunho(formulario.id, {
        secoes: [{ itens: [{ campoId: idDe('nome') }] }],
        termo: 'Aceito.',
      });
      await ok(chamar('POST', `${BASE}/${formulario.id}/publicar`), HTTP_STATUS.CREATED);
      const desativado = await ok(chamar('PUT', `${BASE}/${formulario.id}`, { ativo: false }));
      expect(desativado).toMatchObject({ ativo: false, versaoAtual: { versao: PRIMEIRA } });
      expect(desativado.rascunho.secoes[0].itens).toHaveLength(1);
      expect((await ok(chamar('PUT', `${BASE}/${formulario.id}`, { ativo: true }))).ativo).toBe(
        true,
      );
    });

    it('nome repetido, sem diferenciar maiúscula, é 409', async () => {
      await novoFormulario('Pós-venda');
      const resposta = await chamar('POST', BASE, { nome: 'PÓS-VENDA' });
      expect(resposta.status).toBe(HTTP_STATUS.CONFLICT);
    });
  });

  describe('acesso', () => {
    it('OPERADOR não configura formulários', async () => {
      expect((await chamar('GET', BASE, undefined, 'OPERADOR')).status).toBe(HTTP_STATUS.FORBIDDEN);
      expect((await chamar('POST', BASE, { nome: 'X' }, 'OPERADOR')).status).toBe(
        HTTP_STATUS.FORBIDDEN,
      );
    });

    it('sem a flag, nada responde', async () => {
      await prisma.tenantModuleFeature.deleteMany({
        where: { tenantId, featureKey: CRM_FEATURES.FORMULARIOS },
      });
      await invalidarFeatures(tenantId);
      try {
        expect((await chamar('GET', BASE)).status).toBe(HTTP_STATUS.FORBIDDEN);
      } finally {
        await prisma.tenantModuleFeature.create({
          data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
        });
        await invalidarFeatures(tenantId);
      }
    });

    it('formulário de outro tenant é 404', async () => {
      const resposta = await chamar('GET', `${BASE}/${randomUUID()}`);
      expect(resposta.status).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });
});
