-- Aposentadoria antecipada do modelo antigo de campos
-- (docs/plano-crm-configuracoes.md, M1.8). Sem produção, a flag
-- `crm.campos_v2`, a escrita dupla e o backfill eram só andaime: aqui o
-- estado que existir é convertido uma vez pra `crm_field` e as tabelas
-- antigas saem. Idempotente o bastante pra rodar num banco já reconciliado
-- (tudo é ON CONFLICT DO NOTHING / só mexe no que falta).

-- 1) Campos do sistema pra todo tenant com CRM ou com dado de CRM.
-- Snapshot do contrato (CAMPOS_SISTEMA em constants.js, 2026-10-15) — só
-- pra esta conversão; dali em diante quem semeia é o reconcile.
-- Camada 2 herda visível/ordem/obrigatório de tenant_lead_field_visibility.
WITH contrato(system_key, coluna, label, tipo, camada, posicao, obrigatorio) AS (
  VALUES
    ('nome'::varchar, NULL::varchar, 'Nome'::varchar, 'texto'::varchar, 1, 0, true),
    ('email', NULL, 'E-mail', 'texto', 1, 1, false),
    ('telefone', NULL, 'Telefone', 'texto', 1, 2, false),
    ('fonteLead', NULL, 'Origem do lead', 'selecao', 1, 3, false),
    ('status', NULL, 'Status', 'selecao', 1, 4, false),
    ('tags', NULL, 'Tags', 'selecao_multipla', 1, 5, false),
    ('ultimaInteracaoEm', NULL, 'Última interação', 'data', 1, 6, false),
    ('empresa', 'empresa', 'Empresa', 'texto', 2, 0, false),
    ('cargo', 'cargo', 'Cargo', 'texto', 2, 0, false),
    ('cpf', 'cpf', 'CPF', 'texto', 2, 0, false),
    ('cnpj', 'cnpj', 'CNPJ', 'texto', 2, 0, false),
    ('cidade', 'cidade', 'Cidade', 'texto', 2, 0, false),
    ('uf', 'uf', 'UF', 'texto', 2, 0, false),
    ('cep', 'cep', 'CEP', 'texto', 2, 0, false),
    ('endereco', 'endereco', 'Endereço', 'texto', 2, 0, false),
    ('campanhaUtm', 'campanha_utm', 'Campanha (UTM)', 'texto', 2, 0, false),
    ('dataConversao', 'data_conversao', 'Data de conversão', 'data', 2, 0, false),
    ('probabilidadeFechamento', 'probabilidade_fechamento', 'Probabilidade de fechamento', 'numero', 2, 0, false),
    ('dataPrevistaFechamento', 'data_prevista_fechamento', 'Data prevista de fechamento', 'data', 2, 0, false),
    ('motivoPerda', 'motivo_perda', 'Motivo da perda', 'selecao', 2, 0, false),
    ('leadScore', 'lead_score', 'Lead score', 'numero', 2, 0, false),
    ('proximoFollowup', 'proximo_followup', 'Próximo follow-up', 'data', 2, 0, false)
),
-- Só tenant que existe: o banco de dev tinha lead órfão (tenant apagado
-- sem cascade), e crm_field tem FK pra tenants.
alvos AS (
  SELECT origem.tenant_id
  FROM (
    SELECT tenant_id FROM tenant_modules WHERE module_key = 'crm'
    UNION SELECT tenant_id FROM modulo_crm.tenant_lead_field_definitions
    UNION SELECT tenant_id FROM modulo_crm.tenant_lead_field_visibility
    UNION SELECT tenant_id FROM modulo_crm.leads
  ) AS origem
  JOIN tenants t ON t.id = origem.tenant_id
),
novos AS (
  INSERT INTO modulo_crm.crm_field (tenant_id, system_key, chave, label, type, position, is_required)
  SELECT a.tenant_id, c.system_key, c.system_key, c.label, c.tipo,
         CASE WHEN c.camada = 2 THEN COALESCE(v.ordem, 0) ELSE c.posicao END,
         CASE WHEN c.camada = 2 THEN COALESCE(v.obrigatorio, false) ELSE c.obrigatorio END
  FROM alvos a
  CROSS JOIN contrato c
  LEFT JOIN modulo_crm.tenant_lead_field_visibility v ON v.tenant_id = a.tenant_id AND v.coluna = c.coluna
  ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING
  RETURNING id, tenant_id, system_key
)
INSERT INTO modulo_crm.crm_field_visibility (tenant_id, field_id, context, visible)
SELECT n.tenant_id, n.id, contexto.nome,
       CASE WHEN c.camada = 1 THEN true ELSE COALESCE(v.visivel, false) END
FROM novos n
JOIN contrato c ON c.system_key = n.system_key
LEFT JOIN modulo_crm.tenant_lead_field_visibility v ON v.tenant_id = n.tenant_id AND v.coluna = c.coluna
CROSS JOIN (VALUES ('create_form'), ('detail'), ('table'), ('filter')) AS contexto(nome)
ON CONFLICT (field_id, context) DO NOTHING;

-- 2) Personalizados com o MESMO id (é por ele que custom_fields é indexado).
INSERT INTO modulo_crm.crm_field
  (id, tenant_id, system_key, chave, label, type, options, position, is_required, created_at)
SELECT d.id, d.tenant_id, NULL, d.chave, d.label, d.tipo, d.opcoes, d.ordem, d.obrigatorio, d.created_at
FROM modulo_crm.tenant_lead_field_definitions d
ON CONFLICT (id) DO NOTHING;

INSERT INTO modulo_crm.crm_field_visibility (tenant_id, field_id, context, visible)
SELECT f.tenant_id, f.id, contexto.nome, true
FROM modulo_crm.crm_field f
CROSS JOIN (VALUES ('create_form'), ('detail'), ('table'), ('filter')) AS contexto(nome)
WHERE f.system_key IS NULL
ON CONFLICT (field_id, context) DO NOTHING;

-- 3) custom_fields só por id: pra cada personalizado ativo, o valor vai pra
-- chave `id` (o que já estiver por id ganha) e a chave antiga sai. Valor de
-- campo excluído fica onde está, sem aparecer na API.
UPDATE modulo_crm.leads l
SET custom_fields = convertido.valores
FROM (
  SELECT lead.id,
         (lead.custom_fields - array_agg(f.chave))
           || jsonb_object_agg(f.id::text, COALESCE(lead.custom_fields -> f.id::text, lead.custom_fields -> f.chave))
           AS valores
  FROM modulo_crm.leads lead
  JOIN modulo_crm.crm_field f
    ON f.tenant_id = lead.tenant_id AND f.system_key IS NULL AND f.is_active
  WHERE lead.custom_fields ? f.chave OR lead.custom_fields ? f.id::text
  GROUP BY lead.id, lead.custom_fields
) AS convertido
WHERE l.id = convertido.id;

-- 4) Fim do modelo antigo e da flag de migração.
DROP TABLE modulo_crm.tenant_lead_field_definitions;
DROP TABLE modulo_crm.tenant_lead_field_visibility;
DELETE FROM tenant_module_features WHERE feature_key = 'crm.campos_v2';
