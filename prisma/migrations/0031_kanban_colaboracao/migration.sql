ALTER TABLE modulo_kanban_universal.card_comments ADD COLUMN edited_at TIMESTAMP;
ALTER TABLE modulo_kanban_universal.email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE modulo_kanban_universal.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN ('assignment','mention','due','update'));
CREATE FUNCTION modulo_kanban_universal.notify_followers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c modulo_kanban_universal.cards;
BEGIN
 IF TG_TABLE_NAME='card_comments' THEN
   SELECT * INTO c FROM modulo_kanban_universal.cards WHERE tenant_id=NEW.tenant_id AND id=NEW.card_id;
 ELSE
   c := NEW;
   IF (NEW.titulo,NEW.coluna_id,NEW.responsavel_id,NEW.archived_at,NEW.dados_extras - 'seguidores') IS NOT DISTINCT FROM (OLD.titulo,OLD.coluna_id,OLD.responsavel_id,OLD.archived_at,OLD.dados_extras - 'seguidores') THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO modulo_kanban_universal.email_outbox(tenant_id,board_id,card_id,usuario_id,kind,dedupe_key)
 SELECT c.tenant_id,c.board_id,c.id,u.id,'update',gen_random_uuid()::text
 FROM public.usuarios u
 WHERE u.tenant_id=c.tenant_id AND u.ativo
 AND u.id::text IN (SELECT jsonb_array_elements_text(COALESCE(c.dados_extras->'seguidores','[]'::jsonb)))
 AND u.id IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid;
 RETURN NULL;
END $$;
CREATE TRIGGER kanban_notify_followers AFTER UPDATE ON modulo_kanban_universal.cards FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.notify_followers();
CREATE TRIGGER kanban_notify_comment_followers AFTER INSERT OR UPDATE ON modulo_kanban_universal.card_comments FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.notify_followers();
