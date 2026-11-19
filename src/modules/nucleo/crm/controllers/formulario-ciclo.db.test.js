import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { purgarLixeira } from '../adapters/leads.repository.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { atualizarConfiguracaoCampo } from '../services/configuracoes-campos.service.js';
import { criarNovaDefinicao } from '../services/field-definitions.service.js';
import { invalidarSchemaCampos } from '../services/field-schema.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FM6: formulários no ciclo de vida da pessoa (anonimizar, mesclar, arquivar,
 * lixeira e purga). Tenant padrão com as flags de cada ação. GRAVA no banco
 * de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const BYTES_DA_CHAVE = 32;
const ORDEM = 96;
const UM_DIA_MS = 86_400_000;
const TOKEN_NA_URL = /\/f\/([A-Za-z0-9_-]{43})$/;
const CONFIG = '/crm/configuracoes/formularios';
/** Textos únicos: procurados no banco inteiro do tenant depois de anonimizar. */
const SEGREDOS = Object.freeze({
  ALERGIA: 'Dipirona-FM6',
  OBSERVACAO: 'Observacao-FM6',
  RESPONSAVEL: 'Joana-FM6',
});

rodar('formulários no ciclo de vida da pessoa (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  let app;
  let anamnese;
  let pesquisa;
  let campoNome;
  let alergias;
  let gestante;
  let perguntas;
  let ipDaVez = 0;

  async function chamar(method, url, payload) {
    const token = app.jwt.access.sign({ tenantId, userId: donoId, role: 'DONO' });
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
  const novaPessoa = async (nome = 'Paula Reis') =>
    (
      await ok(
        chamar('POST', '/crm/leads', { nome, email: `${randomUUID()}@smoke.test` }),
        HTTP_STATUS.CREATED,
      )
    ).id;
  const novoLink = async (leadId, formulario = anamnese) => {
    const link = await ok(
      chamar('POST', `/crm/leads/${leadId}/formularios/${formulario.id}/link`, {}),
      HTTP_STATUS.CREATED,
    );
    return { id: link.link.id, token: link.url.match(TOKEN_NA_URL)[1] };
  };
  async function responder(token, respostas, extra = {}) {
    ipDaVez += 1;
    const resposta = await app.inject({
      method: 'POST',
      url: `/public/f/${token}/respostas`,
      payload: { respostas, aceite: true, preenchidoPor: 'titular', ...extra },
      remoteAddress: `10.6.0.${ipDaVez}`,
      headers: { 'user-agent': 'Navegador FM6' },
    });
    expect(resposta.statusCode, resposta.body).toBe(HTTP_STATUS.CREATED);
  }
  const statusDoLink = async (linkId) => {
    const [linha] = await prisma.$queryRaw`
      SELECT status, lead_id::text FROM modulo_crm.crm_form_link WHERE id = ${linkId}::uuid
    `;
    return linha;
  };
  async function publicar(nome, itens, alertas = []) {
    const criado = await ok(chamar('POST', CONFIG, { nome }), HTTP_STATUS.CREATED);
    const salvo = await ok(
      chamar('PUT', `${CONFIG}/${criado.id}`, {
        rascunho: { secoes: [{ itens }], termo: 'Aceito.' },
      }),
    );
    const comAlertas = await ok(
      chamar('PUT', `${CONFIG}/${criado.id}`, {
        rascunho: { ...salvo.rascunho, alertas: alertas(salvo.rascunho.secoes[0].itens) },
      }),
    );
    await ok(chamar('POST', `${CONFIG}/${criado.id}/publicar`), HTTP_STATUS.CREATED);
    return { ...criado, itens: comAlertas.rascunho.secoes[0].itens };
  }

  beforeAll(async () => {
    process.env.FORMS_TOKEN_KEY ??= randomBytes(BYTES_DA_CHAVE).toString('base64');
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE ciclo formularios',
        subdomain: `smoke-ciclo-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
    await prisma.tenantModuleFeature.createMany({
      data: [
        CRM_FEATURES.FORMULARIOS,
        CRM_FEATURES.LGPD,
        CRM_FEATURES.DUPLICIDADE,
        CRM_FEATURES.ARQUIVO,
      ].map((featureKey) => ({ tenantId, moduleKey: MODULO_CRM, featureKey })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    alergias = await criarNovaDefinicao(tenantId, {
      label: 'Alergias',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });
    // Seleção sobrevive à anonimização, a não ser que seja sensível (FM6).
    gestante = await criarNovaDefinicao(tenantId, {
      label: 'Gestante',
      tipo: 'selecao',
      opcoes: ['sim', 'nao'],
      obrigatorio: false,
      ordem: ORDEM + 1,
    });
    for (const campo of [alergias, gestante]) {
      await atualizarConfiguracaoCampo(tenantId, campo.id, { sensivel: true });
    }
    await invalidarSchemaCampos(tenantId);

    app = await buildApp({
      config: {
        APP_NAME: 'crm-formulario-ciclo',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    const elegiveis = await ok(chamar('GET', `${CONFIG}/campos-elegiveis`));
    campoNome = elegiveis.find((campo) => campo.chave === 'nome').id;
    const opcaoSim = elegiveis.find((campo) => campo.id === gestante.id).opcoes[0];
    gestante.sim = opcaoSim;
    anamnese = await publicar(
      'Anamnese',
      [
        { campoId: campoNome },
        { campoId: alergias.id },
        { campoId: gestante.id },
        { pergunta: { rotulo: 'Fuma?', tipo: 'booleano', sensivel: true } },
        { pergunta: { rotulo: 'Observações', tipo: 'texto_longo' } },
      ],
      (itens) => [
        {
          alvo: { perguntaId: itens[3].pergunta.id },
          operador: 'igual',
          valor: true,
          nivel: 'critical',
          texto: 'Fumante',
        },
      ],
    );
    perguntas = { fuma: anamnese.itens[3].pergunta.id, observacao: anamnese.itens[4].pergunta.id };
    pesquisa = await publicar('Pesquisa', [{ campoId: campoNome }], () => []);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('aceite da FM6: anonimizar', () => {
    it('nenhuma resposta sensível sobra nas respostas, nos campos, no histórico ou no outbox', async () => {
      const leadId = await novaPessoa();
      const respondido = await novoLink(leadId);
      await responder(
        respondido.token,
        {
          [campoNome]: 'Paula Reis',
          [alergias.id]: SEGREDOS.ALERGIA,
          [gestante.id]: gestante.sim,
          [perguntas.fuma]: true,
          [perguntas.observacao]: SEGREDOS.OBSERVACAO,
        },
        { preenchidoPor: 'responsavel', nomeResponsavel: SEGREDOS.RESPONSAVEL },
      );
      const pendente = await novoLink(leadId, pesquisa);
      expect(await ok(chamar('GET', `/crm/leads/${leadId}/formularios/alertas`))).toHaveLength(1);

      await ok(chamar('POST', `/crm/leads/${leadId}/anonimizar`));

      expect((await statusDoLink(pendente.id)).status).toBe('revoked');
      const [resposta] = await prisma.$queryRaw`
        SELECT answers, guardian_name, ip, user_agent, filled_by, write_report, consent_hash
        FROM modulo_crm.crm_form_submission WHERE lead_id = ${leadId}::uuid
      `;
      expect(resposta).toMatchObject({
        answers: { campos: {}, perguntas: {} },
        guardian_name: 'Anonimizado',
        ip: null,
        user_agent: null,
        filled_by: 'responsavel',
      });
      // Metadados ficam: o relatório (sem valores) e o hash do termo.
      expect(resposta.write_report.length).toBeGreaterThan(0);
      expect(resposta.consent_hash).not.toBeNull();

      const [{ alertas }] = await prisma.$queryRaw`
        SELECT count(*)::int AS alertas FROM modulo_crm.crm_form_alert WHERE lead_id = ${leadId}::uuid
      `;
      expect(alertas).toBe(0);

      const [{ sobras }] = await prisma.$queryRaw`
        SELECT (
          (SELECT count(*) FROM modulo_crm.crm_form_submission r
            WHERE r.tenant_id = ${tenantId}::uuid AND to_jsonb(r)::text ~ ${Object.values(SEGREDOS).join('|')})
          + (SELECT count(*) FROM modulo_crm.leads l
            WHERE l.tenant_id = ${tenantId}::uuid AND to_jsonb(l)::text ~ ${Object.values(SEGREDOS).join('|')})
          + (SELECT count(*) FROM modulo_crm.crm_lead_event e
            WHERE e.tenant_id = ${tenantId}::uuid AND to_jsonb(e)::text ~ ${Object.values(SEGREDOS).join('|')})
          + (SELECT count(*) FROM modulo_crm.crm_event o
            WHERE o.tenant_id = ${tenantId}::uuid AND to_jsonb(o)::text ~ ${Object.values(SEGREDOS).join('|')})
        )::int AS sobras
      `;
      expect(sobras).toBe(0);
      const [pessoa] = await prisma.$queryRaw`
        SELECT custom_fields FROM modulo_crm.leads WHERE id = ${leadId}::uuid
      `;
      expect(pessoa.custom_fields).not.toHaveProperty(gestante.id);
      expect(pessoa.custom_fields).not.toHaveProperty(alergias.id);

      // "Ver respostas" continua listando, sem valores.
      const [resumo] = await ok(chamar('GET', `/crm/leads/${leadId}/formularios/respostas`));
      const detalhe = await ok(
        chamar('GET', `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`),
      );
      expect(detalhe.secoes[0].itens.every((item) => item.valor === null)).toBe(true);
    });
  });

  describe('mesclar', () => {
    it('links, respostas e alertas vão para o principal; dos dois ativos fica o mais novo', async () => {
      const principalId = await novaPessoa('Paula Principal');
      const secundarioId = await novaPessoa('Paula Secundaria');
      const doPrincipal = await novoLink(principalId);
      const doSecundario = await novoLink(secundarioId);
      const respondido = await novoLink(secundarioId, pesquisa);
      await responder(respondido.token, { [campoNome]: 'Paula Secundaria' });

      await ok(chamar('POST', '/crm/leads/merge', { principalId, secundarioId }));

      expect(await statusDoLink(doPrincipal.id)).toEqual({
        status: 'revoked',
        lead_id: principalId,
      });
      expect(await statusDoLink(doSecundario.id)).toEqual({
        status: 'active',
        lead_id: principalId,
      });
      expect((await statusDoLink(respondido.id)).lead_id).toBe(principalId);
      const respostas = await ok(chamar('GET', `/crm/leads/${principalId}/formularios/respostas`));
      expect(respostas.map((resposta) => resposta.formulario.nome)).toEqual(['Pesquisa']);
      const [{ ativos }] = await prisma.$queryRaw`
        SELECT count(*)::int AS ativos FROM modulo_crm.crm_form_link
        WHERE lead_id = ${principalId}::uuid AND form_id = ${anamnese.id}::uuid AND status = 'active'
      `;
      expect(ativos).toBe(1);
    });

    it('o alerta do descartado vai para o principal', async () => {
      const principalId = await novaPessoa('Rui Principal');
      const secundarioId = await novaPessoa('Rui Secundario');
      const link = await novoLink(secundarioId);
      await responder(link.token, { [campoNome]: 'Rui Secundario', [perguntas.fuma]: true });
      await ok(chamar('POST', '/crm/leads/merge', { principalId, secundarioId }));
      const alertas = await ok(chamar('GET', `/crm/leads/${principalId}/formularios/alertas`));
      expect(alertas.map((alerta) => alerta.texto)).toEqual(['Fumante']);
    });
  });

  describe('arquivar, lixeira e purga', () => {
    it('arquivar revoga os links ativos; desarquivar não os traz de volta', async () => {
      const leadId = await novaPessoa();
      const link = await novoLink(leadId);
      await ok(chamar('POST', `/crm/leads/${leadId}/arquivar`));
      expect((await statusDoLink(link.id)).status).toBe('revoked');
      await ok(chamar('POST', `/crm/leads/${leadId}/desarquivar`));
      expect((await statusDoLink(link.id)).status).toBe('revoked');
    });

    it('lixeira revoga os links ativos, e a purga apaga respostas, alertas e links', async () => {
      const leadId = await novaPessoa();
      const respondido = await novoLink(leadId);
      await responder(respondido.token, { [campoNome]: 'Paula Reis', [perguntas.fuma]: true });
      const pendente = await novoLink(leadId, pesquisa);
      await ok(chamar('DELETE', `/crm/leads/${leadId}`));
      expect((await statusDoLink(pendente.id)).status).toBe('revoked');

      await purgarLixeira(tenantId, new Date(Date.now() + UM_DIA_MS));
      const [contagem] = await prisma.$queryRaw`
        SELECT
          (SELECT count(*) FROM modulo_crm.crm_form_link WHERE lead_id = ${leadId}::uuid)::int AS links,
          (SELECT count(*) FROM modulo_crm.crm_form_submission WHERE lead_id = ${leadId}::uuid)::int AS respostas,
          (SELECT count(*) FROM modulo_crm.crm_form_alert WHERE lead_id = ${leadId}::uuid)::int AS alertas
      `;
      expect(contagem).toEqual({ links: 0, respostas: 0, alertas: 0 });
    });
  });

  it('a resposta segue imutável: o GUC da mesclagem só deixa trocar a pessoa', async () => {
    const leadId = await novaPessoa();
    const link = await novoLink(leadId, pesquisa);
    await responder(link.token, { [campoNome]: 'Paula Reis' });
    await expect(
      getTenantClient(tenantId, async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.form_mesclando', 'on', true)`;
        await tx.$executeRaw`
          UPDATE modulo_crm.crm_form_submission SET answers = '{}'::jsonb
          WHERE lead_id = ${leadId}::uuid
        `;
      }),
    ).rejects.toThrow(/imutável/);
    await expect(
      getTenantClient(
        tenantId,
        (tx) => tx.$executeRaw`
          UPDATE modulo_crm.crm_form_submission SET answers = '{}'::jsonb
          WHERE lead_id = ${leadId}::uuid
        `,
      ),
    ).rejects.toThrow(/imutável/);
  });
});
