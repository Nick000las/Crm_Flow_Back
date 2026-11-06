-- M2.5, F1 (docs/crm/plano-execucao-crm-kanban.md): pipelines comerciais.
-- Aditiva: nada lê esta tabela até a F2. Baseada em
-- docs/crm/referencia-schema-0030-0034.sql, com número novo.
--
-- `sales` é funil de venda e `service`, pós-venda. Só `service` nasce sozinho
-- de uma venda ganha (`auto_create_*`). O limite de 5 por tenant (D5) é regra
-- de produto e fica no service, porque vai mudar.
CREATE TABLE modulo_crm.crm_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_create_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_create_from_pipeline_id UUID,
  auto_create_initial_status VARCHAR,
  auto_create_owner_rule VARCHAR NOT NULL DEFAULT 'person_owner',
  auto_create_owner_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT chk_crm_pipeline_type CHECK (type IN ('sales', 'service')),
  CONSTRAINT chk_crm_pipeline_padrao CHECK (NOT is_default OR (type = 'sales' AND is_active)),
  CONSTRAINT chk_crm_pipeline_auto_criacao
    CHECK (type = 'service' OR (NOT auto_create_enabled AND auto_create_from_pipeline_id IS NULL)),
  CONSTRAINT chk_crm_pipeline_owner_rule
    CHECK (auto_create_owner_rule IN ('person_owner', 'specific_user', 'none')),
  CONSTRAINT fk_crm_pipeline_auto_origem FOREIGN KEY (tenant_id, auto_create_from_pipeline_id)
    REFERENCES modulo_crm.crm_pipeline (tenant_id, id),
  CONSTRAINT fk_crm_pipeline_auto_dono FOREIGN KEY (tenant_id, auto_create_owner_id)
    REFERENCES public.usuarios (tenant_id, id) ON DELETE SET NULL (auto_create_owner_id)
);
-- Um padrão por tenant: é onde lead novo e importação criam a oportunidade.
CREATE UNIQUE INDEX uq_crm_pipeline_padrao ON modulo_crm.crm_pipeline (tenant_id) WHERE is_default;
CREATE INDEX idx_crm_pipeline_tenant_position ON modulo_crm.crm_pipeline (tenant_id, position);

CREATE TRIGGER trg_crm_pipeline_updated_at BEFORE UPDATE ON modulo_crm.crm_pipeline
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE modulo_crm.crm_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_pipeline
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON modulo_crm.crm_pipeline TO app_tenant;
