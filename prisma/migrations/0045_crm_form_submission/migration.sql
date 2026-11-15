-- FM4 (docs/crm/plano-execucao-formularios-forecast.md): resposta do formulário.
--
-- Uma resposta por link (UNIQUE em link_id): o clique duplo não grava duas.
-- A resposta é o que a pessoa declarou, na versão do link, e não muda depois:
-- editar a ficha não altera "Ver respostas". `write_report` diz, campo a
-- campo, o que foi gravado na pessoa, ignorado ou mandado para revisão.
--
-- `answers` guarda { campos: { <campoId>: valor }, perguntas: { <perguntaId>: valor } }.
-- `consent_hash` é o SHA-256 do termo exibido, para provar qual texto foi aceito.
-- `filled_by`: quem preencheu ('titular' ou 'responsavel', com o nome dele).
--
-- Imutável por trigger. A anonimização (FM6) vai precisar apagar respostas:
-- ela entra por um caminho próprio, nunca por UPDATE comum.
CREATE TABLE modulo_crm.crm_form_submission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id UUID NOT NULL,
  form_version_id UUID NOT NULL,
  link_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  deal_id UUID,
  answers JSONB NOT NULL,
  consent_hash BYTEA NOT NULL,
  consent_accepted_at TIMESTAMP NOT NULL,
  filled_by VARCHAR NOT NULL,
  guardian_name VARCHAR,
  ip VARCHAR,
  user_agent VARCHAR,
  write_report JSONB NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT uq_crm_form_submission_link UNIQUE (link_id),
  CONSTRAINT chk_crm_form_submission_quem CHECK (filled_by IN ('titular', 'responsavel')),
  CONSTRAINT chk_crm_form_submission_responsavel
    CHECK ((filled_by = 'responsavel') = (guardian_name IS NOT NULL)),
  CONSTRAINT fk_crm_form_submission_form FOREIGN KEY (tenant_id, form_id)
    REFERENCES modulo_crm.crm_form (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_submission_versao FOREIGN KEY (tenant_id, form_version_id)
    REFERENCES modulo_crm.crm_form_version (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_submission_link FOREIGN KEY (tenant_id, link_id)
    REFERENCES modulo_crm.crm_form_link (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_submission_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES modulo_crm.leads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_submission_deal FOREIGN KEY (tenant_id, deal_id)
    REFERENCES modulo_crm.crm_deal (tenant_id, id) ON DELETE SET NULL (deal_id)
);
CREATE INDEX idx_crm_form_submission_lead
  ON modulo_crm.crm_form_submission (tenant_id, lead_id, submitted_at);

-- `ON DELETE SET NULL (deal_id)` da FK é um UPDATE interno: o trigger deixa
-- passar só a mudança de deal_id para nulo.
CREATE FUNCTION modulo_crm.crm_form_submission_imutavel() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deal_id IS NULL AND OLD.deal_id IS NOT NULL
     AND (to_jsonb(NEW) - 'deal_id') = (to_jsonb(OLD) - 'deal_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'crm_form_submission é imutável';
END;
$$;
CREATE TRIGGER trg_crm_form_submission_imutavel BEFORE UPDATE ON modulo_crm.crm_form_submission
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.crm_form_submission_imutavel();

ALTER TABLE modulo_crm.crm_form_submission ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form_submission
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, DELETE ON modulo_crm.crm_form_submission TO app_tenant;
