import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { buscarCandidatos } from '../adapters/crm-duplicates.repository.js';
import { transicionarStatus, buscarImportJob } from '../adapters/import-jobs.repository.js';
import { condicaoEsfriando } from '../adapters/crm-inatividade.sql.js';
import {
  buscarLeadPorId,
  buscarLeadsComFiltro,
  mesclarLeads as mesclarLeadsRepository,
  purgarLixeira,
} from '../adapters/leads.repository.js';
import {
  CAMPOS_SISTEMA,
  CRM_FEATURES,
  LISTA_CONTEXTOS_VISIBILIDADE,
  LISTAS_SEMEADAS,
  MODULO_CRM,
  OPCOES_SUGERIDAS,
  REGRAS_DO_SISTEMA,
  SUGESTAO_DIAS_ESFRIAR,
} from '../constants.js';
import { arquivarLead, excluirLead, restaurarLead } from './arquivo.service.js';
import { editarAtividade, listarAtividades, registrarAtividade } from './atividades.service.js';
import { salvarRegras } from './duplicidade.service.js';
import { criarRegra, editarRegra, listarRegras, removerRegra } from './regras.service.js';
import { listarHistorico } from './historico.service.js';
import { listarInatividade, notificarEsfriandoNoTenant, salvarInatividade } from './inatividade.service.js';
import { processarImportacao, validarImportacao } from './import.service.js';
import { mesclarLeads, montarMesclagem } from './mesclagem.service.js';
import { gerarPlanilha } from './planilha.service.js';
import { exportarLeads } from './export.service.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
  restaurarOrdemPadrao,
} from './configuracoes-campos.service.js';
import { criarNovaDefinicao, removerDefinicao } from './field-definitions.service.js';
import { camposDoContexto, obterSchemaCampos } from './field-schema.service.js';
import { inicioDaLixeira } from './lead-filter.service.js';
import {
  atualizarLeadExistente,
  buscarLeadFormatado,
  pesquisarLeads,
  registrarNovoLead,
} from './leads.service.js';
import { obterLayout, salvarMeu, salvarPadrao } from './layout.service.js';
import { excluirOpcao, listarListas } from './listas.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Integração dos campos (`crm_field`) contra o Postgres de verdade: semear
 * os campos do sistema é idempotente, `custom_fields` vai por `id` e volta
 * por `chave`, filtro e Configurações (M2) funcionam no SQL real.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE campos", apagado no fim)
 * — por isso só roda com `CRM_DB_TESTS=1`, num banco de dev:
 *
 *   CRM_DB_TESTS=1 pnpm vitest run src/modules/nucleo/crm/services/campos.db.test.js
 *
 * Exige as migrations até a 0023 aplicadas.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_PAGINA = 50;
const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const ORDEM_SEGMENTO = 40;
/** O teste do M7 encadeia import, mesclagem e histórico: bem mais idas ao banco. */
const TIMEOUT_TESTE_LONGO_MS = 30_000;
const LINHA_PLANILHA_ANA = 2;

rodar('campos do CRM no banco (CRM_DB_TESTS=1)', () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const usuarioId = randomUUID();

  async function contar() {
    const [linha] = await prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM modulo_crm.crm_field WHERE tenant_id = ${tenantId}::uuid) AS campos,
        (SELECT count(*)::int FROM modulo_crm.crm_field_visibility WHERE tenant_id = ${tenantId}::uuid) AS visibilidades
    `;
    return linha;
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE campos', subdomain: `smoke-campos-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.create({
      data: { id: usuarioId, tenantId, nome: 'Smoke', email: `smoke-${tenantId}@smoke.test`, role: 'DONO', ativo: true },
    });
  });

  afterAll(async () => {
    // Leads antes: `fk_leads_usuario_responsavel` não tem cascade e barra o
    // cascade tenant → usuarios enquanto um lead aponta pro responsável.
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it('reconcile duas vezes: semeia os campos do sistema uma vez só', async () => {
    const primeira = await reconciliarTenant(tenantId);
    const depois = await contar();
    const segunda = await reconciliarTenant(tenantId);

    const opcoesSugeridas = LISTAS_SEMEADAS.reduce((total, kind) => total + OPCOES_SUGERIDAS[kind].length, 0);
    expect(primeira).toEqual([
      { passo: 'campos-sistema', resultado: { criados: CAMPOS_SISTEMA.length } },
      { passo: 'listas-padrao', resultado: { criadas: opcoesSugeridas } }, // tenant sem lead: padrão da spec
      { passo: 'regras-padrao', resultado: { criadas: REGRAS_DO_SISTEMA.length } }, // Perdido exige Motivo (M8)
    ]);
    expect(segunda).toEqual([
      { passo: 'campos-sistema', resultado: { criados: 0 } },
      { passo: 'listas-padrao', resultado: { criadas: 0 } },
      { passo: 'regras-padrao', resultado: { criadas: 0 } },
    ]);
    expect(depois.campos).toBe(CAMPOS_SISTEMA.length);
    expect(depois.visibilidades).toBe(CAMPOS_SISTEMA.length * LISTA_CONTEXTOS_VISIBILIDADE.length);
    expect(await contar()).toEqual(depois);
  });

  it('personalizado: grava por id, volta por chave, filtra pelo id; excluir esconde sem apagar', async () => {
    const campo = await criarNovaDefinicao(tenantId, {
      label: 'Segmento smoke',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM_SEGMENTO,
    });
    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Lead A', email: 'a@smoke.test', customFields: { segmento_smoke: 'varejo' } },
      usuarioId,
    );

    const [gravado] = await prisma.$queryRaw`
      SELECT custom_fields FROM modulo_crm.leads WHERE id = ${leadId}::uuid
    `;
    expect(gravado.custom_fields).toEqual({ [campo.id]: 'varejo' });
    expect((await buscarLeadFormatado(tenantId, leadId)).custom_fields).toEqual({ segmento_smoke: 'varejo' });

    const busca = await pesquisarLeads(tenantId, {
      filtros: [{ chave: 'segmento_smoke', operador: 'igual', valor: 'varejo' }],
      paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA },
    });
    expect(busca.total).toBe(1);

    await removerDefinicao(tenantId, campo.id);
    expect((await buscarLeadFormatado(tenantId, leadId)).custom_fields).toEqual({});
    const [aindaGravado] = await prisma.$queryRaw`
      SELECT custom_fields FROM modulo_crm.leads WHERE id = ${leadId}::uuid
    `;
    expect(aindaGravado.custom_fields).toEqual({ [campo.id]: 'varejo' });
  });

  it('Configurações (M2): ocultar só na tabela, renomear e voltar ao padrão', async () => {
    const empresa = (await listarConfiguracaoCampos(tenantId)).find((campo) => campo.chave === 'empresa');

    await atualizarConfiguracaoCampo(tenantId, empresa.id, {
      label: 'Razão social',
      visibilidade: { create_form: true, detail: true, filter: true, table: false },
    });
    const { campos } = await obterSchemaCampos(tenantId);
    expect(camposDoContexto(campos, 'table').map((campo) => campo.chave)).not.toContain('empresa');
    expect(camposDoContexto(campos, 'detail').find((campo) => campo.chave === 'empresa').label).toBe(
      'Razão social',
    );

    const ordenados = await restaurarOrdemPadrao(tenantId);
    expect(ordenados.map((campo) => campo.ordem)).toEqual(ordenados.map((_, indice) => indice));
  });

  it('Listas (M3): só opção da lista entra, tag nova vira opção, opção em uso não é excluída', async () => {
    await expect(
      registrarNovoLead(tenantId, { nome: 'Lead B', email: 'b@smoke.test', status: 'negociacao' }, usuarioId),
    ).rejects.toThrow(/não é uma opção de Status/); // tenant novo: padrão da spec, sem "negociacao"

    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Lead C', email: 'c@smoke.test', status: 'proposta', tags: ['Feira 2026'] },
      usuarioId,
    );
    const [gravado] = await prisma.$queryRaw`SELECT status, tags FROM modulo_crm.leads WHERE id = ${leadId}::uuid`;
    expect(gravado).toEqual({ status: 'proposta', tags: ['feira_2026'] });

    const listas = await listarListas(tenantId);
    expect(listas.tag).toEqual([expect.objectContaining({ key: 'feira_2026', label: 'Feira 2026', usos: 1 })]);
    const proposta = listas.status.find((opcao) => opcao.key === 'proposta');
    expect(proposta.usos).toBe(1);
    await expect(excluirOpcao(tenantId, 'status', proposta.id)).rejects.toThrow(/desative em vez de excluir/);
  });

  it('Layout (M4): CNPJ como identificador, Empresa · Cidade no subtítulo, busca com e sem pontuação', async () => {
    const configurados = await listarConfiguracaoCampos(tenantId);
    const id = (chave) => configurados.find((campo) => campo.chave === chave).id;
    const todosOsContextos = { create_form: true, detail: true, table: true, filter: true };
    for (const chave of ['cnpj', 'empresa', 'cidade']) {
      await atualizarConfiguracaoCampo(tenantId, id(chave), { visibilidade: todosOsContextos });
    }

    const padrao = {
      identificador: id('cnpj'),
      subtitulo: [id('empresa'), id('cidade')],
      destaques: ['lead.valor', id('status')],
      secoes: [{ nome: 'Empresa', campos: [id('empresa'), id('cnpj'), id('cidade')] }],
      colunas: [id('empresa'), id('telefone')],
    };
    await salvarPadrao(tenantId, usuarioId, padrao);
    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Acme', email: 'acme@smoke.test', cnpj: '11.222.333/0001-81', empresa: 'Acme SA', cidade: 'Joinville' },
      usuarioId,
    );

    for (const busca of ['11.222.333/0001-81', '11222333000181', '11.222']) {
      const resultado = await pesquisarLeads(tenantId, { busca, paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA } });
      expect(resultado.itens.map((lead) => lead.id), busca).toEqual([leadId]);
    }

    const { efetivo } = await obterLayout(tenantId, usuarioId);
    expect(efetivo.identificador.chave).toBe('cnpj');
    expect(efetivo.subtitulo.map((item) => item.chave)).toEqual(['empresa', 'cidade']);

    // Override do usuário; depois o DONO acrescenta uma coluna → entra no fim da lista dele.
    await salvarMeu(tenantId, usuarioId, { colunas: [id('telefone')] });
    await salvarPadrao(tenantId, usuarioId, { ...padrao, colunas: [...padrao.colunas, id('cidade')] });
    const depois = await obterLayout(tenantId, usuarioId);
    expect(depois.efetivo.colunas.map((item) => item.chave)).toEqual(['telefone', 'cidade']);
  });

  it('Arquivo e lixeira (M5): nada vaza da lixeira, restaurar no prazo, purga depois', async () => {
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.ARQUIVO },
    });
    await invalidarFeatures(tenantId);

    const criar = async (nome, email) => (await registrarNovoLead(tenantId, { nome, email }, usuarioId)).id;
    const arquivado = await criar('M5 arquivado', 'm5-arq@smoke.test');
    const excluido = await criar('M5 excluido', 'm5-exc@smoke.test');
    const vencido = await criar('M5 vencido', 'm5-venc@smoke.test');
    await arquivarLead(tenantId, arquivado);
    await excluirLead(tenantId, excluido);
    await excluirLead(tenantId, vencido);
    // Excluído há 31 dias: passou do prazo, mas a purga ainda não rodou.
    await prisma.$executeRaw`
      UPDATE modulo_crm.leads SET deleted_at = now() - interval '31 days' WHERE id = ${vencido}::uuid
    `;

    const buscar = (situacao) =>
      pesquisarLeads(tenantId, { busca: 'm5', situacao, paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA } });
    const ids = async (situacao) => (await buscar(situacao)).itens.map((lead) => lead.id);

    // Busca e contagem.
    expect(await ids()).toEqual([]);
    expect(await ids('arquivados')).toEqual([arquivado]);
    const lixeira = await buscar('lixeira');
    expect(lixeira.itens.map((lead) => lead.id)).toEqual([excluido]); // o vencido já não aparece
    expect(lixeira.total).toBe(1);
    expect(lixeira.itens[0].purga_em).toBeInstanceOf(Date);

    // Detalhe e edição: 404. Arquivado continua legível.
    await expect(buscarLeadFormatado(tenantId, excluido)).rejects.toThrow('Lead não encontrado');
    await expect(atualizarLeadExistente(tenantId, excluido, { nome: 'Outro' })).rejects.toThrow('Lead não encontrado');
    await expect(buscarLeadFormatado(tenantId, arquivado)).resolves.toMatchObject({ id: arquivado });
    // Edição (de arquivado inclusive) devolve as colunas da leitura, `estagio_nome` incluso.
    const editado = await atualizarLeadExistente(tenantId, arquivado, { nome: 'M5 arquivado editado' });
    expect(editado).toHaveProperty('estagio_nome');
    expect(editado.archived_at).toBeInstanceOf(Date);

    // Deduplicação do import: lixeira não conta, arquivado conta.
    await expect(buscarCandidatos(tenantId, { email: 'm5-exc@smoke.test' })).resolves.toEqual([]);
    await expect(buscarCandidatos(tenantId, { email: 'm5-arq@smoke.test' })).resolves.toEqual([
      expect.objectContaining({ id: arquivado, campos: ['email'] }),
    ]);

    // Export: a lixeira não sai.
    await expect(exportarLeads(tenantId, { colunas: ['nome'], filtro: { situacao: 'lixeira' } })).rejects.toThrow(
      'A lixeira não pode ser exportada',
    );

    // Restaurar: dentro do prazo volta; fora dele, 404.
    await expect(restaurarLead(tenantId, vencido)).rejects.toThrow('Lead não encontrado');
    await restaurarLead(tenantId, excluido);
    expect(await ids()).toEqual([excluido]);

    // Purga (só deste tenant): apaga de vez o vencido.
    await expect(purgarLixeira(tenantId, inicioDaLixeira())).resolves.toBe(1);
    const [{ existe }] = await prisma.$queryRaw`
      SELECT EXISTS (SELECT 1 FROM modulo_crm.leads WHERE id = ${vencido}::uuid) AS existe
    `;
    expect(existe).toBe(false);
  });

  it('Atividades e histórico (M6): interação, diff só do que mudou, append-only', async () => {
    const autorId = randomUUID();
    await prisma.usuario.create({
      data: { id: autorId, tenantId, nome: 'Smoke operador', email: `smoke-op-${autorId}@smoke.test`, role: 'OPERADOR', ativo: true },
    });
    const { listas } = await obterSchemaCampos(tenantId);
    const [statusA, statusB] = listas.status.map((opcao) => opcao.key);
    const { id: leadId } = await registrarNovoLead(tenantId, { nome: 'M6 lead', email: 'm6@smoke.test', status: statusA }, autorId);

    const interacao = async () => {
      const [{ ultima_interacao_em: valor }] = await prisma.$queryRaw`
        SELECT ultima_interacao_em FROM modulo_crm.leads WHERE id = ${leadId}::uuid
      `;
      return valor;
    };
    const voltarInteracao = () => prisma.$executeRaw`
      UPDATE modulo_crm.leads SET ultima_interacao_em = '2020-01-01' WHERE id = ${leadId}::uuid
    `;
    const ANTIGA = new Date('2020-01-01T00:00:00Z');

    // Editar um campo não conta como interação (D1); mudar o status conta.
    await atualizarLeadExistente(tenantId, leadId, { nome: 'M6 lead editado' }, autorId);
    expect(await interacao()).toBeNull();
    await atualizarLeadExistente(tenantId, leadId, { status: statusB }, autorId);
    expect(await interacao()).not.toBeNull();
    // Mesmo status de novo: nem interação nem evento.
    await voltarInteracao();
    await atualizarLeadExistente(tenantId, leadId, { status: statusB }, autorId);
    expect(await interacao()).toEqual(ANTIGA);

    // Concluir atividade (na criação ou depois) atualiza a interação.
    await registrarAtividade(tenantId, leadId, { tipo: 'ligacao', titulo: 'Liguei', concluida: true }, autorId);
    expect((await interacao()) > ANTIGA).toBe(true);
    await voltarInteracao();
    const reuniao = await registrarAtividade(
      tenantId,
      leadId,
      { tipo: 'reuniao', titulo: 'Apresentação', agendadaPara: new Date('2030-01-01T13:00:00Z') },
      autorId,
    );
    expect(await interacao()).toEqual(ANTIGA); // agendar não é interação
    await editarAtividade(tenantId, leadId, reuniao.id, { concluida: true });
    expect((await interacao()) > ANTIGA).toBe(true);
    const atividades = await listarAtividades(tenantId, leadId);
    expect(atividades.map((atividade) => atividade.titulo).sort()).toEqual(['Apresentação', 'Liguei']);
    expect(atividades[0].autor).toEqual({ id: autorId, nome: 'Smoke operador' });

    // Histórico: mais novo primeiro, só os campos alterados, autor do token.
    const { itens } = await listarHistorico(tenantId, leadId, { pagina: 1, tamanho: TAMANHO_PAGINA });
    expect(itens.map((evento) => evento.tipo)).toEqual(['atualizado', 'atualizado', 'criado']);
    expect(itens[0].diff).toEqual([
      expect.objectContaining({ campo: 'status', chave: 'status', antes: statusA, depois: statusB }),
    ]);
    expect(itens[1].diff).toEqual([
      expect.objectContaining({ campo: 'nome', antes: 'M6 lead', depois: 'M6 lead editado' }),
    ]);
    expect(itens[2].autor).toEqual({ id: autorId, nome: 'Smoke operador' });

    // Append-only: o conteúdo não muda...
    await expect(prisma.$executeRaw`
      UPDATE modulo_crm.crm_lead_event SET diff = '[]' WHERE lead_id = ${leadId}::uuid
    `).rejects.toThrow(/append-only/);
    // ...mas o usuário pode sair: o autor vira nulo (ON DELETE SET NULL passa no trigger).
    await prisma.usuario.delete({ where: { id: autorId } });
    const depois = await listarHistorico(tenantId, leadId, { pagina: 1, tamanho: TAMANHO_PAGINA });
    expect(depois.itens.every((evento) => evento.autor === null)).toBe(true);
  });

  it('Duplicidade e mesclagem (M7): avisar, bloquear, 9º dígito, import igual ao form, mesclagem atômica', async () => {
    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.DUPLICIDADE },
    });
    await invalidarFeatures(tenantId);

    const { id: ana } = await registrarNovoLead(
      tenantId,
      { nome: 'M7 Ana', email: 'm7-ana@smoke.test', telefone: '(47) 98888-7777' },
      usuarioId,
    );

    // Avisar (padrão do telefone): mesmo celular sem o 9 → 409; confirmando, salva.
    const semNove = { nome: 'M7 Ana de novo', telefone: '47 8888-7777' };
    await expect(registrarNovoLead(tenantId, semNove, usuarioId)).rejects.toMatchObject({
      code: 'DUPLICATE_WARNING',
      details: { duplicados: [expect.objectContaining({ id: ana, acao: 'warn' })] },
    });
    const { id: anaDeNovo } = await registrarNovoLead(tenantId, { ...semNove, ignorarDuplicados: true }, usuarioId);

    // Bloquear no e-mail: nem confirmando.
    await salvarRegras(tenantId, [{ campo: 'email', acao: 'block', ativo: true }]);
    await expect(
      registrarNovoLead(tenantId, { nome: 'Outra', email: ' M7-ANA@smoke.test', ignorarDuplicados: true }, usuarioId),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BLOCKED' });

    // Import aplica as mesmas regras: linha 2 repete a Ana (bloqueia); a 4 repete a 3 (dentro da planilha).
    const planilha = await gerarPlanilha(
      ['Nome', 'E-mail'],
      [
        ['M7 Planilha', 'm7-ana@smoke.test'],
        ['M7 Nova', 'm7-nova@smoke.test'],
        ['M7 Nova repetida', 'M7-NOVA@smoke.test'],
      ],
    );
    const validado = await validarImportacao(tenantId, usuarioId, planilha, {
      mapeamento: { Nome: 'nome', 'E-mail': 'email' },
      estrategiaDuplicata: 'criar',
    });
    expect(validado.duplicados).toEqual([expect.objectContaining({ linha: LINHA_PLANILHA_ANA, acao: 'block' })]);
    await transicionarStatus(tenantId, validado.jobId, 'pendente', 'processando');
    await processarImportacao(tenantId, validado.jobId);
    const job = await buscarImportJob(tenantId, validado.jobId);
    // Ignoradas: a linha 2 (repete a Ana) e a 4 (repete a 3, criada logo antes).
    expect(job).toMatchObject({ linhas_criadas: 1, linhas_ignoradas: ['linha 2', 'linha 4'].length });

    // Mesclagem atômica: falha depois de mover as atividades (responsável que não existe) → nada muda.
    await registrarAtividade(tenantId, anaDeNovo, { tipo: 'ligacao', titulo: 'M7 ligação' }, usuarioId);
    await expect(
      mesclarLeadsRepository(
        tenantId,
        { principalId: ana, secundarioId: anaDeNovo },
        {
          autorId: usuarioId,
          montar: (principal, secundario) => ({
            ...montarMesclagem(principal, secundario),
            usuarioResponsavelId: randomUUID(),
          }),
          montarDiff: () => [],
        },
      ),
    ).rejects.toThrow();
    expect((await listarAtividades(tenantId, anaDeNovo)).map((atividade) => atividade.titulo)).toEqual(['M7 ligação']);
    await expect(buscarLeadFormatado(tenantId, anaDeNovo)).resolves.toMatchObject({ id: anaDeNovo });

    // Mesclagem de verdade: nome do secundário, atividade e histórico vêm junto, o descartado não volta.
    const mesclado = await mesclarLeads(
      tenantId,
      { principalId: ana, secundarioId: anaDeNovo, escolhas: { nome: 'secundario' } },
      usuarioId,
    );
    expect(mesclado).toMatchObject({ id: ana, nome: 'M7 Ana de novo', email: 'm7-ana@smoke.test' });
    expect((await listarAtividades(tenantId, ana)).map((atividade) => atividade.titulo)).toEqual(['M7 ligação']);
    await expect(buscarLeadFormatado(tenantId, anaDeNovo)).rejects.toThrow('Lead não encontrado');
    await expect(restaurarLead(tenantId, anaDeNovo, usuarioId)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    // Na lixeira, o descartado mostra em quem foi mesclado (pedido do front).
    const lixeira = await pesquisarLeads(tenantId, {
      busca: 'M7 Ana',
      situacao: 'lixeira',
      paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA },
    });
    expect(lixeira.itens).toEqual([
      expect.objectContaining({ id: anaDeNovo, mesclado_em_id: ana, mesclado_em_nome: 'M7 Ana de novo' }),
    ]);
    // Apagar o principal de vez leva o descartado junto (FK CASCADE, migration 0021):
    // nunca sobra um lead mesclado sem a marca. Numa transação desfeita, pra o resto do teste seguir.
    const sobra = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM modulo_crm.leads WHERE id = ${ana}::uuid`;
      const [linha] = await tx.$queryRaw`
        SELECT EXISTS (SELECT 1 FROM modulo_crm.leads WHERE id = ${anaDeNovo}::uuid) AS existe
      `;
      throw Object.assign(new Error('rollback'), { existe: linha.existe });
    }).catch((erro) => erro.existe);
    expect(sobra).toBe(false);

    const { itens } = await listarHistorico(tenantId, ana, { pagina: 1, tamanho: TAMANHO_PAGINA });
    expect(itens[0]).toMatchObject({
      tipo: 'mesclado',
      detalhes: { leadDescartadoId: anaDeNovo, nomeDescartado: 'M7 Ana de novo' },
    });
    expect(itens[0].diff).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'nome', depois: 'M7 Ana de novo' })]));
    // O "criado" do secundário veio junto pro principal.
    expect(itens.filter((evento) => evento.tipo === 'criado')).toHaveLength([ana, anaDeNovo].length);
  }, TIMEOUT_TESTE_LONGO_MS);

  it('Regras (M8): Perdido exige Motivo na edição parcial, condicional, desligar a do sistema', async () => {
    await prisma.tenantModuleFeature.create({ data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.REGRAS } });
    await invalidarFeatures(tenantId);

    const configurados = await listarConfiguracaoCampos(tenantId);
    const id = (chave) => configurados.find((campo) => campo.chave === chave).id;
    const todosOsContextos = { create_form: true, detail: true, table: true, filter: true };
    await atualizarConfiguracaoCampo(tenantId, id('motivoPerda'), { visibilidade: todosOsContextos });

    const { listas } = await obterSchemaCampos(tenantId);
    const statusDe = (categoria) => listas.status.find((opcao) => opcao.category === categoria && opcao.ativo).key;
    const perdido = statusDe('perdido');
    const [motivo] = listas.motivo_perda.map((opcao) => opcao.key);
    const [fonte] = listas.fonte_lead.map((opcao) => opcao.key);

    // A regra semeada aparece resolvida, apontando pro Motivo da perda.
    const doSistema = (await listarRegras(tenantId)).find((regra) => regra.sistema);
    expect(doSistema).toMatchObject({ kind: 'required_from_status', alvo: { chave: 'motivoPerda' }, ativo: true });

    // Edição parcial que muda SÓ o status pra perdido, sem motivo → 400.
    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'M8 lead', email: 'm8@smoke.test', status: statusDe('aberto') },
      usuarioId,
    );
    await expect(atualizarLeadExistente(tenantId, leadId, { status: perdido }, usuarioId)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { motivoPerda: [expect.stringContaining('"Motivo da perda" é obrigatório')] },
    });
    await expect(
      atualizarLeadExistente(tenantId, leadId, { status: perdido, motivoPerda: motivo }, usuarioId),
    ).resolves.toMatchObject({ status: perdido, motivo_perda: motivo });

    // Condicional: Origem = <fonte> exige Empresa.
    await criarRegra(tenantId, {
      kind: 'conditional',
      campoId: id('empresa'),
      condicao: { campoId: id('fonteLead'), operador: 'igual', valor: fonte },
      efeito: { obrigatorio: true },
    });
    await expect(
      registrarNovoLead(tenantId, { nome: 'M8 sem empresa', email: 'm8-b@smoke.test', fonteLead: fonte }, usuarioId),
    ).rejects.toThrow(/é obrigatório por causa do valor de/); // Empresa (renomeada no teste do M2)
    await expect(
      registrarNovoLead(tenantId, { nome: 'M8 com empresa', email: 'm8-c@smoke.test', fonteLead: fonte, empresa: 'Acme' }, usuarioId),
    ).resolves.toHaveProperty('id');

    // A do sistema desliga, mas não sai.
    await editarRegra(tenantId, doSistema.id, { ativo: false });
    await expect(
      registrarNovoLead(tenantId, { nome: 'M8 perdido', email: 'm8-d@smoke.test', status: perdido }, usuarioId),
    ).resolves.toHaveProperty('id');
    await expect(removerRegra(tenantId, doSistema.id)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
  }, TIMEOUT_TESTE_LONGO_MS);

  it('Lead esfriando (M9): limite, pausa por atividade agendada, reset, filtro e resumo diário', async () => {
    await prisma.tenantModuleFeature.createMany({
      data: [{ tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.INATIVIDADE }],
      skipDuplicates: true,
    });
    await invalidarFeatures(tenantId);
    const HORA_MS = 3_600_000;
    const HORAS_POR_DIA = 24;
    const DIA_MS = HORAS_POR_DIA * HORA_MS;
    const EM_CONTATO = SUGESTAO_DIAS_ESFRIAR.em_contato;
    const QUALIFICADO = SUGESTAO_DIAS_ESFRIAR.qualificado;
    const DIAS_ATE_A_AGENDADA = 10;
    const DIAS_ATE_O_RESUMO = 30;
    const MEIO_DIA_EM_SAO_PAULO_UTC = 15;
    const depoisDe = (inicio, ms) => new Date(inicio.getTime() + ms);
    const dias = (quantos) => quantos * DIA_MS;

    // Status semeados com as sugestões; ganho/perdido desligados.
    const configurados = Object.fromEntries((await listarInatividade(tenantId)).map((opcao) => [opcao.key, opcao.dias]));
    const { novo, em_contato: emContato, qualificado, proposta } = SUGESTAO_DIAS_ESFRIAR;
    // Tenant sem lead nasce com os status sugeridos (sem "negociacao").
    expect(configurados).toEqual({ novo, em_contato: emContato, qualificado, proposta, ganho: null, perdido: null });
    await expect(salvarInatividade(tenantId, { status: { ganho: EM_CONTATO } })).rejects.toThrow('não esfria');

    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'M9 esfriando', email: 'm9@smoke.test', status: 'em_contato' },
      usuarioId,
    );
    const interacao = new Date('2026-01-10T12:00:00Z');
    await prisma.$executeRaw`UPDATE modulo_crm.leads SET ultima_interacao_em = ${interacao} WHERE id = ${leadId}::uuid`;
    const esfriandoDesde = async (agora) =>
      (await buscarLeadPorId(tenantId, leadId, { inatividade: agora }))?.esfriando_desde ?? null;
    const limite = depoisDe(interacao, dias(EM_CONTATO));

    // Limite: 1h antes ainda não; no limite, sim (desde a data-limite).
    expect(await esfriandoDesde(depoisDe(limite, -HORA_MS))).toBeNull();
    expect(await esfriandoDesde(limite)).toEqual(limite);

    // O filtro bate com o indicador, no mesmo relógio.
    const noFiltro = async (agora) =>
      (await buscarLeadsComFiltro(tenantId, [condicaoEsfriando(agora)], { limite: TAMANHO_PAGINA, offset: 0 })).itens.some(
        (lead) => lead.id === leadId,
      );
    expect(await noFiltro(depoisDe(limite, -HORA_MS))).toBe(false);
    expect(await noFiltro(limite)).toBe(true);

    // Pausa: atividade agendada empurra a contagem até a data dela; depois, volta.
    const agendada = depoisDe(interacao, dias(DIAS_ATE_A_AGENDADA));
    await prisma.$executeRaw`
      INSERT INTO modulo_crm.crm_activity (tenant_id, lead_id, tipo, titulo, agendada_para)
      VALUES (${tenantId}::uuid, ${leadId}::uuid, 'ligacao', 'Retornar', ${agendada})
    `;
    const limiteDepoisDaPausa = depoisDe(agendada, dias(EM_CONTATO));
    expect(await esfriandoDesde(limite)).toBeNull();
    expect(await esfriandoDesde(depoisDe(limiteDepoisDaPausa, -HORA_MS))).toBeNull();
    expect(await esfriandoDesde(limiteDepoisDaPausa)).toEqual(limiteDepoisDaPausa);

    // Pela busca de verdade (relógio real): o lead parado desde janeiro está esfriando.
    const { itens } = await pesquisarLeads(tenantId, {
      esfriando: true,
      filtros: [],
      paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA },
    });
    expect(itens.find((lead) => lead.id === leadId)?.esfriando_desde).toEqual(limiteDepoisDaPausa);

    // Reset: concluir uma atividade conta como interação (agora, relógio real).
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_activity WHERE lead_id = ${leadId}::uuid`;
    await registrarAtividade(tenantId, leadId, { tipo: 'ligacao', titulo: 'Liguei', concluida: true }, usuarioId);
    expect(await esfriandoDesde(depoisDe(new Date(), dias(EM_CONTATO) - HORA_MS))).toBeNull();
    expect(await esfriandoDesde(depoisDe(new Date(), dias(EM_CONTATO) + HORA_MS))).not.toBeNull();

    // Reset: trocar o status também — e passa a valer o prazo do status novo.
    await atualizarLeadExistente(tenantId, leadId, { status: 'qualificado' }, usuarioId);
    expect(await esfriandoDesde(depoisDe(new Date(), dias(QUALIFICADO) - HORA_MS))).toBeNull();
    expect(await esfriandoDesde(depoisDe(new Date(), dias(QUALIFICADO) + HORA_MS))).not.toBeNull();

    // Resumo do dia: um pro responsável e, do lead sem responsável, um pro DONO.
    // Rodar de novo no mesmo dia (local) não cria nada.
    await registrarNovoLead(tenantId, { nome: 'M9 sem dono', email: 'm9-b@smoke.test', status: 'novo' });
    const meioDia = depoisDe(new Date(), dias(DIAS_ATE_O_RESUMO));
    meioDia.setUTCHours(MEIO_DIA_EM_SAO_PAULO_UTC, 0, 0, 0);
    const tenant = { tenantId, fusoHorario: 'America/Sao_Paulo' };
    const esperadas = [
      [usuarioId, 'crm.esfriando'],
      [usuarioId, 'crm.esfriando_sem_responsavel'],
    ];
    await expect(notificarEsfriandoNoTenant(tenant, meioDia)).resolves.toBe(esperadas.length);
    await expect(notificarEsfriandoNoTenant(tenant, depoisDe(meioDia, HORA_MS))).resolves.toBe(0);
    const notificacoes = await prisma.$queryRaw`
      SELECT usuario_id, tipo FROM notificacoes WHERE tenant_id = ${tenantId}::uuid ORDER BY tipo
    `;
    expect(notificacoes.map((notificacao) => [notificacao.usuario_id, notificacao.tipo])).toEqual(esperadas);
  }, TIMEOUT_TESTE_LONGO_MS);
});
