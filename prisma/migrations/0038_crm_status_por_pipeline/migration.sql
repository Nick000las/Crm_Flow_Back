-- M2.5, F2: todo status pertence a um pipeline, e a mesma key pode existir em
-- pipelines diferentes.
--
-- Isto é migration de dado, ao contrário da regra do reconcile, porque a
-- constraint precisa valer sobre as linhas que já existem: sem o pipeline
-- Vendas e o backfill, o CHECK abaixo falharia. O restante do seed (Atendimento
-- e seus status) segue em `pnpm crm:reconcile`.
INSERT INTO modulo_crm.crm_pipeline (tenant_id, name, type, is_default)
SELECT DISTINCT o.tenant_id, 'Vendas', 'sales', true
FROM modulo_crm.crm_option o
WHERE o.kind = 'status'
  AND NOT EXISTS (
    SELECT 1 FROM modulo_crm.crm_pipeline p WHERE p.tenant_id = o.tenant_id AND p.is_default
  );

UPDATE modulo_crm.crm_option o
SET pipeline_id = p.id
FROM modulo_crm.crm_pipeline p
WHERE p.tenant_id = o.tenant_id AND p.is_default AND o.kind = 'status' AND o.pipeline_id IS NULL;

ALTER TABLE modulo_crm.crm_option
  DROP CONSTRAINT crm_option_tenant_id_kind_key_key,
  ADD CONSTRAINT uq_crm_option_chave UNIQUE NULLS NOT DISTINCT (tenant_id, kind, pipeline_id, key),
  ADD CONSTRAINT chk_crm_option_pipeline CHECK (
    CASE kind
      WHEN 'status' THEN pipeline_id IS NOT NULL
      WHEN 'motivo_perda' THEN true
      ELSE pipeline_id IS NULL
    END
  );
