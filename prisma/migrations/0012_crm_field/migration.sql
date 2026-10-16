-- Registro único de campos do CRM (docs/plano-crm-configuracoes.md, M1).
-- Aditiva: as tabelas antigas (tenant_lead_field_definitions /
-- tenant_lead_field_visibility) continuam e recebem escrita dupla por uma
-- release; o backfill é feito por `pnpm crm:reconcile` (idempotente), não
-- aqui — dado de configuração por tenant não entra em migration.

-- Uma linha por campo do tenant. Campo do sistema: `system_key` = chave do
-- contrato (CAMPOS_SISTEMA em constants.js, que continua sendo a fonte de
-- coluna/tipo/capacidades). Personalizado: `system_key` NULL e o `id` é o
-- mesmo de tenant_lead_field_definitions, porque `leads.custom_fields`
-- passa a ser indexado por ele. `chave` é o slug estável exposto na API.
-- Sem CHECK em `type`: os tipos crescem (M2/M11) e são validados pelo
-- contrato na aplicação.
CREATE TABLE modulo_crm.crm_field (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_key VARCHAR,
  chave VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  type VARCHAR NOT NULL,
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Alvo das FKs compostas das tabelas filhas: garante que filho e campo
  -- são do mesmo tenant (a FK simples por id aceitaria outro tenant).
  UNIQUE (tenant_id, id)
);

-- Alvo do ON CONFLICT do reconcile: um campo do sistema por tenant.
CREATE UNIQUE INDEX uq_crm_field_system_key
  ON modulo_crm.crm_field (tenant_id, system_key) WHERE system_key IS NOT NULL;
-- Chave de personalizado ativo é única; desativado (excluído) libera a
-- chave pra um campo novo, com outro id — o dado antigo fica no id antigo.
CREATE UNIQUE INDEX uq_crm_field_chave_personalizado_ativo
  ON modulo_crm.crm_field (tenant_id, chave) WHERE system_key IS NULL AND is_active;
CREATE INDEX idx_crm_field_tenant_position ON modulo_crm.crm_field (tenant_id, position);

ALTER TABLE modulo_crm.crm_field ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_field
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Visibilidade por contexto, contexto como linha (contexto novo sem
-- migration). Sem linha = padrão do contrato.
CREATE TABLE modulo_crm.crm_field_visibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_id UUID NOT NULL,
  context VARCHAR NOT NULL CHECK (context IN ('create_form','detail','table','filter')),
  visible BOOLEAN NOT NULL,

  UNIQUE (field_id, context),
  FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE modulo_crm.crm_field_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_field_visibility
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_field_visibility_tenant ON modulo_crm.crm_field_visibility (tenant_id);

-- Criadas vazias agora; usadas em M8 (regras) e M13 (permissão por campo).
CREATE TABLE modulo_crm.crm_field_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_id UUID NOT NULL,
  kind VARCHAR NOT NULL CHECK (kind IN ('required','required_from_status','conditional')),
  condition JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE modulo_crm.crm_field_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_field_rule
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_field_rule_tenant_field ON modulo_crm.crm_field_rule (tenant_id, field_id);

CREATE TABLE modulo_crm.crm_field_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_id UUID NOT NULL,
  role VARCHAR NOT NULL,
  access VARCHAR NOT NULL CHECK (access IN ('edit','view','hidden')),

  UNIQUE (field_id, role),
  FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE modulo_crm.crm_field_permission ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_field_permission
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_field_permission_tenant ON modulo_crm.crm_field_permission (tenant_id);
