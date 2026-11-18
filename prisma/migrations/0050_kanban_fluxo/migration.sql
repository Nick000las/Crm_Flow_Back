-- Configuração de fluxo pertence à coluna existente, já protegida por RLS.
ALTER TABLE modulo_kanban_universal.colunas ADD COLUMN regras_fluxo JSONB NOT NULL DEFAULT '{}';
ALTER TABLE modulo_kanban_universal.cards ADD COLUMN etapa_desde TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE modulo_kanban_universal.cards c SET etapa_desde = COALESCE((
 SELECT max(a.created_at) FROM modulo_kanban_universal.activities a
 WHERE a.tenant_id=c.tenant_id AND a.card_id=c.id AND a.action IN ('card.create','card.move','card.restore')
 AND a.details->>'colunaId'=c.coluna_id::text
 AND NOT (a.action='card.move' AND a.details ? 'novaOrdem')
), c.created_at);
CREATE FUNCTION modulo_kanban_universal.update_stage_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.coluna_id IS DISTINCT FROM OLD.coluna_id OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL) THEN
  NEW.etapa_desde := CURRENT_TIMESTAMP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_stage_since BEFORE UPDATE ON modulo_kanban_universal.cards
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.update_stage_since();
ALTER TABLE modulo_kanban_universal.email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE modulo_kanban_universal.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN ('assignment','mention','due','update','next_action'));
