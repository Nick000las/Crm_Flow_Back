-- Regras de obrigatoriedade por status e condicionais (docs/crm/plano-configuracoes.md, M8).
--
-- A tabela nasceu vazia na 0012 (M1, filha de crm_field); aqui ganha o
-- que faltava. `field_id` é o campo afetado. Formato por `kind`:
--   required_from_status: condition = { status?: [keys], categorias?: ['aberto'|'ganho'|'perdido'] }
--                         effect    = { obrigatorio: true }
--   conditional:          condition = { campoId, operador, valor? } (operadores do filtro)
--                         effect    = { obrigatorio: bool, visivel: bool }
-- O "sempre obrigatório" ficou em crm_field.is_required (M2): `required` sai do CHECK.
--
-- `system_key`: regra semeada pelo código (ex.: Perdido exige Motivo) —
-- pode ser desligada, não excluída. A semente é idempotente pelo unique parcial.
ALTER TABLE modulo_crm.crm_field_rule
  DROP CONSTRAINT crm_field_rule_kind_check,
  ADD CONSTRAINT crm_field_rule_kind_check CHECK (kind IN ('required_from_status', 'conditional')),
  ADD COLUMN effect JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN system_key VARCHAR,
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX uq_crm_field_rule_system_key
  ON modulo_crm.crm_field_rule (tenant_id, system_key) WHERE system_key IS NOT NULL;
