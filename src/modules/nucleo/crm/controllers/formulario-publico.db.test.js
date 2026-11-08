import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, LIMITE_PUBLICO } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { CRM_FEATURES, LIMITE_POR_LINK, MODULO_CRM } from '../constants.js';
import { atualizarConfiguracaoCampo } from '../services/configuracoes-campos.service.js';
import { criarNovaDefinicao } from '../services/field-definitions.service.js';
import { invalidarSchemaCampos } from '../services/field-schema.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FM3: página pública do link, sem login. Dois tenants padrão com a flag
 * `crm.formularios`. GRAVA no banco de `DATABASE_URL` (tenants SMOKE,
 * apagados no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const BYTES_DA_CHAVE = 32;
const ORDEM = 80;
const TOKEN_NA_URL = /\/f\/([A-Za-z0-9_-]{43})$/;
const CONFIG = '/crm/configuracoes/formularios';
const PUBLICO = '/public/f';
const IPS_POR_FAIXA = 250;
const TAMANHO_DO_TOKEN = 43;
const TERMO = 'Autorizo o uso dos meus dados para o atendimento.';

rodar('página pública do formulário (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const linhasDeLog = [];
  const tenants = [];
  let app;
  let ipDaVez = 0;
  /** Cada teste com um IP próprio: o limite por IP não vaza entre eles. */
  const novoIp = () => {
    ipDaVez += 1;
    return `10.0.${Math.floor(ipDaVez / IPS_POR_FAIXA)}.${ipDaVez % IPS_POR_FAIXA}`;
  };

  async function chamarComo(tenant, method, url, payload) {
    const token = app.jwt.access.sign({ tenantId: tenant.id, userId: tenant.donoId, role: 'DONO' });
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
  async function publica(method, caminho, ip = novoIp()) {
    const resposta = await app.inject({ method, url: caminho, remoteAddress: ip });
    return {
      status: resposta.statusCode,
      corpo: resposta.body ? JSON.parse(resposta.body) : null,
      cabecalhos: resposta.headers,
    };
  }

  async function prepararTenant(nome) {
    const id = randomUUID();
    const donoId = randomUUID();
    await prisma.tenant.create({
      data: { id, nome: `SMOKE ${nome}`, subdomain: `smoke-pub-${id.slice(0, TAMANHO_SUFIXO)}` },
    });
    await prisma.usuario.create({
      data: {
        id: donoId,
        tenantId: id,
        nome: 'Dono',
        email: `${donoId}@smoke.test`,
        senhaHash: 'test',
        role: 'DONO',
      },
    });
    await prisma.tenantModule.create({ data: { tenantId: id, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({
      data: { tenantId: id, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
    });
    await invalidarFeatures(id);
    await reconciliarTenant(id);
    const alergias = await criarNovaDefinicao(id, {
      label: 'Alergias',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });
    await invalidarSchemaCampos(id);
    const tenant = { id, donoId, alergias };
    tenants.push(tenant);
    return tenant;
  }

  /** Formulário publicado: nome e alergias pré-preenchidos, e-mail não, e uma pergunta. */
  async function publicarFormulario(tenant) {
    const elegiveis = await ok(chamarComo(tenant, 'GET', `${CONFIG}/campos-elegiveis`));
    const idDe = (chave) => elegiveis.find((campo) => campo.chave === chave).id;
    const criado = await ok(
      chamarComo(tenant, 'POST', CONFIG, {
        nome: `Anamnese ${randomUUID().slice(0, TAMANHO_SUFIXO)}`,
      }),
      HTTP_STATUS.CREATED,
    );
    await ok(
      chamarComo(tenant, 'PUT', `${CONFIG}/${criado.id}`, {
        rascunho: {
          secoes: [
            {
              titulo: 'Dados',
              itens: [
                { campoId: idDe('nome'), obrigatorio: true, preencher: true },
                { campoId: idDe('email') },
                { campoId: tenant.alergias.id, preencher: true },
                { campoId: idDe('telefone'), preencher: true },
                {
                  pergunta: { rotulo: 'Fuma?', tipo: 'booleano', sensivel: true },
                  obrigatorio: true,
                },
              ],
            },
          ],
          termo: TERMO,
        },
      }),
    );
    await ok(chamarComo(tenant, 'POST', `${CONFIG}/${criado.id}/publicar`), HTTP_STATUS.CREATED);
    return criado;
  }

  async function novoLink(tenant, formulario, nome = 'Maria Souza') {
    const lead = await ok(
      chamarComo(tenant, 'POST', '/crm/leads', {
        nome,
        email: `${randomUUID()}@smoke.test`,
        customFields: { [tenant.alergias.chave]: 'Dipirona' },
      }),
      HTTP_STATUS.CREATED,
    );
    const link = await ok(
      chamarComo(tenant, 'POST', `/crm/leads/${lead.id}/formularios/${formulario.id}/link`, {}),
      HTTP_STATUS.CREATED,
    );
    const [, token] = link.url.match(TOKEN_NA_URL);
    return { leadId: lead.id, linkId: link.link.id, token };
  }

  let tenantA;
  let formularioA;

  beforeAll(async () => {
    process.env.FORMS_TOKEN_KEY ??= randomBytes(BYTES_DA_CHAVE).toString('base64');
    app = await buildApp({
      config: {
        APP_NAME: 'crm-formulario-publico',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
      logger: {
        level: 'info',
        stream: new Writable({
          write(pedaco, _codificacao, pronto) {
            linhasDeLog.push(String(pedaco));
            pronto();
          },
        }),
      },
    });
    tenantA = await prepararTenant('publico A');
    formularioA = await publicarFormulario(tenantA);
  });

  afterAll(async () => {
    for (const tenant of tenants) {
      await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenant.id}::uuid`;
      await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenant.id}::uuid`;
      await prisma.tenant.deleteMany({ where: { id: tenant.id } });
    }
    await app?.close();
    await encerrarCache();
  });

  const abertoEm = async (linkId) => {
    const [linha] = await prisma.$queryRaw`
      SELECT opened_at FROM modulo_crm.crm_form_link WHERE id = ${linkId}::uuid
    `;
    return linha.opened_at;
  };

  it('mostra a versão, o primeiro nome e só os valores que podem vir preenchidos', async () => {
    const { token } = await novoLink(tenantA, formularioA);
    const { status, corpo, cabecalhos } = await publica('GET', `${PUBLICO}/${token}`);
    expect(status).toBe(HTTP_STATUS.OK);
    const { data } = corpo;
    expect(data.pessoa).toEqual({ primeiroNome: 'Maria' });
    expect(data.formulario.nome).toMatch(/^Anamnese/);
    expect(data.versao.termo).toBe(TERMO);

    const [nome, email, alergias, telefone, fuma] = data.versao.secoes[0].itens;
    expect(nome).toMatchObject({
      obrigatorio: true,
      valor: 'Maria Souza',
      campo: { label: 'Nome' },
    });
    expect(email.valor).toBeNull();
    expect(alergias.valor).toBe('Dipirona');
    // Marcado para vir preenchido, mas a pessoa não tem telefone.
    expect(telefone.valor).toBeNull();
    expect(fuma).toEqual({
      pergunta: {
        id: expect.any(String),
        rotulo: 'Fuma?',
        ajuda: null,
        tipo: 'booleano',
        opcoes: null,
      },
      obrigatorio: true,
    });
    // Nada interno vai para a página: política, chave, camada, marca de sensível.
    const texto = JSON.stringify(data);
    for (const interno of ['politica', '"chave"', 'camada', 'sensivel', 'preencher']) {
      expect(texto).not.toContain(interno);
    }

    expect(cabecalhos['cache-control']).toBe('no-store');
    expect(cabecalhos['referrer-policy']).toBe('no-referrer');
    expect(cabecalhos['x-robots-tag']).toContain('noindex');
  });

  it('GET repetido não marca o link como aberto; o POST marca uma vez só', async () => {
    const { token, linkId } = await novoLink(tenantA, formularioA);
    await publica('GET', `${PUBLICO}/${token}`);
    await publica('GET', `${PUBLICO}/${token}`);
    expect(await abertoEm(linkId)).toBeNull();

    expect((await publica('POST', `${PUBLICO}/${token}/aberto`)).status).toBe(HTTP_STATUS.OK);
    const primeira = await abertoEm(linkId);
    expect(primeira).toBeInstanceOf(Date);
    await publica('POST', `${PUBLICO}/${token}/aberto`);
    expect(await abertoEm(linkId)).toEqual(primeira);

    const ficha = await ok(
      chamarComo(
        tenantA,
        'GET',
        `/crm/leads/${(await novoLink(tenantA, formularioA)).leadId}/formularios`,
      ),
    );
    expect(ficha[0].abertoEm).toBeNull();
  });

  it('campo que virou sensível depois de publicar não vem preenchido', async () => {
    const tenant = await prepararTenant('publico sensivel');
    const formulario = await publicarFormulario(tenant);
    const { token } = await novoLink(tenant, formulario);
    await atualizarConfiguracaoCampo(tenant.id, tenant.alergias.id, { sensivel: true });
    await invalidarSchemaCampos(tenant.id);

    const { corpo } = await publica('GET', `${PUBLICO}/${token}`);
    const alergias = corpo.data.versao.secoes[0].itens[2];
    expect(alergias.campo.label).toBe('Alergias');
    expect(alergias.valor).toBeNull();
  });

  describe('o que não abre responde igual', () => {
    const tokenInventado = () => randomBytes(BYTES_DA_CHAVE).toString('base64url');
    let esperado;

    beforeAll(async () => {
      esperado = await publica('GET', `${PUBLICO}/${tokenInventado()}`);
      expect(esperado.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(esperado.cabecalhos['cache-control']).toBe('no-store');
    });
    const igualAoInventado = (resposta) => {
      expect(resposta.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(resposta.corpo.error).toEqual(esperado.corpo.error);
    };

    it('token mal formado', async () => {
      igualAoInventado(await publica('GET', `${PUBLICO}/curto`));
      igualAoInventado(await publica('GET', `${PUBLICO}/${'!'.repeat(TAMANHO_DO_TOKEN)}`));
    });

    it('link revogado não abre (aceite da FM2)', async () => {
      const { token, leadId, linkId } = await novoLink(tenantA, formularioA);
      expect((await publica('GET', `${PUBLICO}/${token}`)).status).toBe(HTTP_STATUS.OK);
      await ok(
        chamarComo(tenantA, 'POST', `/crm/leads/${leadId}/formularios/links/${linkId}/revogar`),
      );
      igualAoInventado(await publica('GET', `${PUBLICO}/${token}`));
      igualAoInventado(await publica('POST', `${PUBLICO}/${token}/aberto`));
    });

    it('link vencido, respondido ou com a pessoa fora', async () => {
      const vencido = await novoLink(tenantA, formularioA);
      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_form_link SET expires_at = CURRENT_TIMESTAMP - interval '1 minute'
        WHERE id = ${vencido.linkId}::uuid
      `;
      igualAoInventado(await publica('GET', `${PUBLICO}/${vencido.token}`));

      const respondido = await novoLink(tenantA, formularioA);
      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_form_link SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
        WHERE id = ${respondido.linkId}::uuid
      `;
      igualAoInventado(await publica('GET', `${PUBLICO}/${respondido.token}`));

      const arquivada = await novoLink(tenantA, formularioA);
      await prisma.$executeRaw`
        UPDATE modulo_crm.leads SET archived_at = CURRENT_TIMESTAMP WHERE id = ${arquivada.leadId}::uuid
      `;
      igualAoInventado(await publica('GET', `${PUBLICO}/${arquivada.token}`));

      const naLixeira = await novoLink(tenantA, formularioA);
      await prisma.$executeRaw`
        UPDATE modulo_crm.leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${naLixeira.leadId}::uuid
      `;
      igualAoInventado(await publica('GET', `${PUBLICO}/${naLixeira.token}`));
    });

    it('formulário desativado, flag desligada, módulo fora ou empresa suspensa', async () => {
      const tenant = await prepararTenant('publico desligado');
      const formulario = await publicarFormulario(tenant);
      const { token } = await novoLink(tenant, formulario);
      const abre = async () => (await publica('GET', `${PUBLICO}/${token}`)).status;
      expect(await abre()).toBe(HTTP_STATUS.OK);

      await ok(chamarComo(tenant, 'PUT', `${CONFIG}/${formulario.id}`, { ativo: false }));
      igualAoInventado(await publica('GET', `${PUBLICO}/${token}`));
      await ok(chamarComo(tenant, 'PUT', `${CONFIG}/${formulario.id}`, { ativo: true }));
      expect(await abre()).toBe(HTTP_STATUS.OK);

      await prisma.tenantModuleFeature.deleteMany({
        where: { tenantId: tenant.id, featureKey: CRM_FEATURES.FORMULARIOS },
      });
      await invalidarFeatures(tenant.id);
      igualAoInventado(await publica('GET', `${PUBLICO}/${token}`));
      await prisma.tenantModuleFeature.create({
        data: { tenantId: tenant.id, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.FORMULARIOS },
      });
      await invalidarFeatures(tenant.id);
      expect(await abre()).toBe(HTTP_STATUS.OK);

      await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'suspenso' } });
      igualAoInventado(await publica('GET', `${PUBLICO}/${token}`));
    });
  });

  it('token de um tenant nunca lê dado de outro', async () => {
    const tenantB = await prepararTenant('publico B');
    const formularioB = await publicarFormulario(tenantB);
    const deA = await novoLink(tenantA, formularioA, 'Xavier Alfa');
    const deB = await novoLink(tenantB, formularioB, 'Yara Beta');

    const lidoA = (await publica('GET', `${PUBLICO}/${deA.token}`)).corpo.data;
    const lidoB = (await publica('GET', `${PUBLICO}/${deB.token}`)).corpo.data;
    expect(lidoA.pessoa.primeiroNome).toBe('Xavier');
    expect(lidoB.pessoa.primeiroNome).toBe('Yara');
    expect(JSON.stringify(lidoA)).not.toContain('Yara');
    expect(JSON.stringify(lidoB)).not.toContain('Xavier');
    expect(lidoA.formulario.nome).not.toBe(lidoB.formulario.nome);

    // O link de B, lido no tenant A sob RLS, não existe.
    const [{ visiveis }] = await getTenantClient(
      tenantA.id,
      (tx) => tx.$queryRaw`
        SELECT count(*)::int AS visiveis FROM modulo_crm.crm_form_link WHERE id = ${deB.linkId}::uuid
      `,
    );
    expect(visiveis).toBe(0);
  });

  describe('limites', () => {
    it('por link: passa do limite e recebe 429', async () => {
      const { token } = await novoLink(tenantA, formularioA);
      const ip = novoIp();
      for (let i = 0; i < LIMITE_POR_LINK.MAX; i += 1) {
        expect((await publica('GET', `${PUBLICO}/${token}`, ip)).status).toBe(HTTP_STATUS.OK);
      }
      const excedido = await publica('GET', `${PUBLICO}/${token}`, novoIp());
      expect(excedido.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
      expect(excedido.corpo.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    });

    it('por IP: tentar adivinhar tokens esbarra no limite', async () => {
      // Em sequência: a store em memória (sem Redis) conta pedidos simultâneos
      // de forma conservadora e bloqueia todos; com Redis a contagem é atômica.
      const ip = novoIp();
      const codigos = [];
      for (let i = 0; i <= LIMITE_PUBLICO.POR_IP; i += 1) {
        codigos.push((await publica('GET', `${PUBLICO}/curto-${randomUUID()}`, ip)).status);
      }
      expect(codigos.filter((codigo) => codigo === HTTP_STATUS.NOT_FOUND)).toHaveLength(
        LIMITE_PUBLICO.POR_IP,
      );
      expect(codigos.at(-1)).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
      // Outro IP continua passando.
      expect((await publica('GET', `${PUBLICO}/curto-${randomUUID()}`)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );
    });
  });

  it('o log não leva o token nem dado da pessoa, só o id do link', async () => {
    const { token, linkId } = await novoLink(tenantA, formularioA, 'Lia Logada');
    await publica('GET', `${PUBLICO}/${token}`);
    await publica('POST', `${PUBLICO}/${token}/aberto`);
    const log = linhasDeLog.join('');
    expect(log).not.toContain(token);
    expect(log).not.toContain('Logada');
    expect(log).toContain('/public/f/[oculto]');
    expect(log).toContain(linkId);
  });
});
