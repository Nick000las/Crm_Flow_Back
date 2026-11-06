-- M2.5, F1: oportunidades e outbox. Aditiva: `usaOportunidades` prioriza o
-- modelo atual enquanto `funil_estagios` e `leads.status` existirem, então
-- nada muda de comportamento até a F4.
--
-- Diferenças em relação a docs/crm/referencia-schema-0030-0034.sql: sem
-- `version` (o projeto usa `expectedUpdatedAt`), sem `won_at_estimated` (só
-- servia à migração de dados antigos), sem `custom_fields` (fora do M2.5), e
-- com `archived_at`, porque a oportunidade arquiva como o lead (P9).
--
-- `crm_option` ganha só a coluna: "todo status tem pipeline" e a nova
-- unicidade entram na F2, junto com o seed, ou quebrariam as opções atuais e
-- o `ON CONFLICT (tenant_id, kind, key)` de `inserirOpcoes`.

ALTER TABLE modulo_crm.leads ADD CONSTRAINT leads_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE modulo_crm.crm_deal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  -- Venda que originou este atendimento.
  source_deal_id UUID,
  title VARCHAR,
  status VARCHAR NOT NULL,
  status_category VARCHAR NOT NULL,
  amount NUMERIC(14, 2),
  probability_override SMALLINT,
  expected_close_date DATE,
  won_at TIMESTAMP,
  lost_at TIMESTAMP,
  lost_reason VARCHAR,
  owner_id UUID,
  source_reopened_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP,
  deleted_at TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT chk_crm_deal_amount CHECK (amount >= 0),
  CONSTRAINT chk_crm_deal_probability CHECK (probability_override BETWEEN 0 AND 100),
  CONSTRAINT chk_crm_deal_status_category CHECK (status_category IN ('aberto', 'ganho', 'perdido')),
  CONSTRAINT chk_crm_deal_datas CHECK (
    (status_category = 'ganho') = (won_at IS NOT NULL)
    AND (status_category = 'perdido') = (lost_at IS NOT NULL)
  ),
  CONSTRAINT fk_crm_deal_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES modulo_crm.leads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_deal_pipeline FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES modulo_crm.crm_pipeline (tenant_id, id),
  CONSTRAINT fk_crm_deal_owner FOREIGN KEY (tenant_id, owner_id)
    REFERENCES public.usuarios (tenant_id, id) ON DELETE SET NULL (owner_id),
  CONSTRAINT fk_crm_deal_source FOREIGN KEY (tenant_id, source_deal_id)
    REFERENCES modulo_crm.crm_deal (tenant_id, id) ON DELETE SET NULL (source_deal_id)
);
CREATE INDEX idx_crm_deal_lead ON modulo_crm.crm_deal (tenant_id, lead_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_crm_deal_quadro_status ON modulo_crm.crm_deal (tenant_id, pipeline_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_crm_deal_previsao
  ON modulo_crm.crm_deal (tenant_id, pipeline_id, status_category, expected_close_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_crm_deal_ganhas ON modulo_crm.crm_deal (tenant_id, pipeline_id, won_at)
  WHERE status_category = 'ganho' AND deleted_at IS NULL;
-- Garante um atendimento por venda: repetir o ganho não duplica o card.
CREATE UNIQUE INDEX uq_crm_deal_origem_quadro ON modulo_crm.crm_deal (source_deal_id, pipeline_id)
  WHERE source_deal_id IS NOT NULL;

CREATE TRIGGER trg_crm_deal_updated_at BEFORE UPDATE ON modulo_crm.crm_deal
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE modulo_crm.crm_deal ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_deal
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON modulo_crm.crm_deal TO app_tenant;

ALTER TABLE modulo_crm.leads
  ADD COLUMN lifecycle_stage VARCHAR NOT NULL DEFAULT 'lead',
  ADD COLUMN lifecycle_changed_at TIMESTAMP,
  ADD COLUMN principal_deal_id UUID,
  ADD CONSTRAINT chk_leads_lifecycle_stage
    CHECK (lifecycle_stage IN ('lead', 'oportunidade', 'cliente')),
  ADD CONSTRAINT fk_leads_principal_deal FOREIGN KEY (tenant_id, principal_deal_id)
    REFERENCES modulo_crm.crm_deal (tenant_id, id) ON DELETE SET NULL (principal_deal_id);

ALTER TABLE modulo_crm.crm_option
  ADD COLUMN pipeline_id UUID,
  ADD CONSTRAINT fk_crm_option_pipeline FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES modulo_crm.crm_pipeline (tenant_id, id);

-- Outbox: gravado na transação de cada mudança e consumido no M5. O payload
-- leva só ids: evento não guarda dado pessoal.
CREATE TABLE modulo_crm.crm_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo VARCHAR NOT NULL,
  entidade VARCHAR NOT NULL,
  entidade_id UUID NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  locked_until TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_crm_event_pendentes ON modulo_crm.crm_event (tenant_id, occurred_at)
  WHERE processed_at IS NULL;
CREATE INDEX idx_crm_event_tenant_ocorrencia ON modulo_crm.crm_event (tenant_id, occurred_at);

CREATE FUNCTION modulo_crm.bloquear_edicao_crm_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.entidade, NEW.entidade_id, NEW.payload, NEW.occurred_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.entidade, OLD.entidade_id, OLD.payload, OLD.occurred_at) THEN
    RAISE EXCEPTION 'crm_event é append-only: só o controle de processamento pode mudar';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_crm_event_append_only BEFORE UPDATE ON modulo_crm.crm_event
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.bloquear_edicao_crm_event();

ALTER TABLE modulo_crm.crm_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_event
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON modulo_crm.crm_event TO app_tenant;
REVOKE DELETE ON modulo_crm.crm_event FROM app_tenant;
