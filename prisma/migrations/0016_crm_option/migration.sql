-- Listas configuráveis do CRM (docs/crm/plano-configuracoes.md, M3):
-- Status, Origem, Motivo de perda, Tipo de atividade e Tag viram opções
-- por tenant. O lead continua guardando a `key` da opção (as mesmas keys
-- de antes) — nenhum UPDATE em leads. As opções são semeadas pelo
-- reconcile (`pnpm crm:reconcile` / preguiçoso no resolver), não aqui.

CREATE TABLE modulo_crm.crm_option (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind VARCHAR NOT NULL CHECK (kind IN ('status','fonte_lead','motivo_perda','tipo_atividade','tag')),
  -- Imutável: é o valor gravado no lead (status/fonte_lead/motivo_perda/tags).
  key VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  color VARCHAR CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  position INTEGER NOT NULL DEFAULT 0,
  -- Só status tem categoria, e todo status tem uma.
  category VARCHAR CHECK (category IN ('aberto','ganho','perdido')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, kind, key),
  UNIQUE (tenant_id, id),
  CONSTRAINT chk_crm_option_categoria CHECK ((kind = 'status') = (category IS NOT NULL))
);

CREATE INDEX idx_crm_option_tenant_kind_position ON modulo_crm.crm_option (tenant_id, kind, position);

ALTER TABLE modulo_crm.crm_option ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_option
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Os valores aceitos passam a ser os da lista do tenant (validados no
-- service). Spike D3: FK composta (tenant_id, kind gerado, key) funciona,
-- mas não foi adotada — ver o plano, M3.
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS leads_fonte_lead_check;
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS leads_motivo_perda_check;
