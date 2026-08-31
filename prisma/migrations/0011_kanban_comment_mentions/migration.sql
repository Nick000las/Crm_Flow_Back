ALTER TABLE modulo_kanban_universal.card_comments
 ADD COLUMN mencionados UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION modulo_kanban_universal.record_comment_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 card modulo_kanban_universal.cards;
BEGIN
 SELECT * INTO card FROM modulo_kanban_universal.cards WHERE tenant_id = NEW.tenant_id AND id = NEW.card_id;
 INSERT INTO modulo_kanban_universal.activities(tenant_id,board_id,card_id,actor_id,action)
 VALUES(NEW.tenant_id,card.board_id,card.id,NEW.usuario_id,'comment.create');
 INSERT INTO modulo_kanban_universal.email_outbox(tenant_id,board_id,card_id,usuario_id,kind,dedupe_key)
 SELECT NEW.tenant_id,card.board_id,card.id,u.id,'mention',NEW.id::text || ':' || u.id::text
 FROM public.usuarios u
 JOIN modulo_kanban_universal.board_members bm ON bm.tenant_id=u.tenant_id AND bm.usuario_id=u.id AND bm.board_id=card.board_id
 WHERE u.tenant_id=NEW.tenant_id AND u.ativo AND u.id<>NEW.usuario_id
   AND (u.id=ANY(NEW.mencionados) OR NEW.conteudo ILIKE '%@{' || u.id::text || '}%')
 ON CONFLICT (tenant_id,dedupe_key) DO NOTHING;
 RETURN NULL;
END $$;
