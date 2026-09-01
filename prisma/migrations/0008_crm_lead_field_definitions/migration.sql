-- Sprint 6-B (docs/plano-crm-campos-filtros-import-export.md, Parte 1).
-- Espelha exatamente o delta adicionado em
-- src/modules/nucleo/crm/prisma/schema.prisma.part — esse arquivo é a fonte
-- de verdade versionada do módulo; esta migration é o que de fato aplica
-- em produção (o fluxo scripts/build-schema.js -> db:apply-modules citado
-- no comentário daquele script não está ligado a nenhum script real no
-- package.json hoje, então module DDL segue pelo mesmo trilho de
-- `prisma migrate deploy` usado pelas migrations 0004-0007).

CREATE TABLE modulo_crm.tenant_lead_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  tipo VARCHAR NOT NULL CHECK (tipo IN ('texto','numero','data','booleano','selecao','selecao_multipla')),
  opcoes JSONB,             -- só usado quando tipo IN ('selecao','selecao_multipla')
  obrigatorio BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, chave)
);

ALTER TABLE modulo_crm.tenant_lead_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.tenant_lead_field_definitions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_lead_field_definitions_tenant_ordem
  ON modulo_crm.tenant_lead_field_definitions(tenant_id, ordem);

-- Dado órfão de propósito quando uma definição é removida (Parte 1.4 do
-- plano) — leads.custom_fields nunca é limpo automaticamente.
ALTER TABLE modulo_crm.leads ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}';
CREATE INDEX idx_leads_custom_fields_gin ON modulo_crm.leads USING GIN (custom_fields);
