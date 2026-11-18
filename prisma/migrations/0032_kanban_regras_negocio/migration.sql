-- SECURITY INVOKER: toda resolução e limpeza conserva o contexto RLS do tenant.
CREATE FUNCTION modulo_kanban_universal.resolve_linked_lead(company UUID, reference TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
 current_id UUID;
 visited UUID[] := '{}';
 lead modulo_crm.leads;
BEGIN
 -- Referências anteriores ao contrato de integração não são convertidas nem apagadas.
 IF reference IS NULL OR reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN reference; END IF;
 current_id := reference::uuid;
 LOOP
  IF current_id = ANY(visited) THEN RETURN NULL; END IF;
  visited := array_append(visited,current_id);
  SELECT * INTO lead FROM modulo_crm.leads WHERE tenant_id=company AND id=current_id FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF lead.mesclado_em_id IS NOT NULL THEN current_id := lead.mesclado_em_id;
  ELSIF lead.deleted_at IS NOT NULL OR lead.anonimizado_em IS NOT NULL THEN RETURN NULL;
  ELSE RETURN lead.id::text;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION modulo_kanban_universal.normalize_card_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rules JSONB; followers JSONB; linked TEXT;
BEGIN
 NEW.dados_extras := COALESCE(NEW.dados_extras,'{}'::jsonb);
 IF jsonb_typeof(NEW.dados_extras->'automacoes')='array' THEN
  SELECT COALESCE(jsonb_agg(
   CASE WHEN rule.item->>'responsavelId' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM modulo_kanban_universal.board_members m JOIN public.usuarios u ON u.tenant_id=m.tenant_id AND u.id=m.usuario_id
    WHERE m.tenant_id=NEW.tenant_id AND m.board_id=NEW.board_id AND u.ativo AND u.id::text=rule.item->>'responsavelId'
   ) THEN rule.item || '{"responsavelId":null}'::jsonb ELSE rule.item END ORDER BY rule.position),'[]'::jsonb)
  INTO rules FROM jsonb_array_elements(NEW.dados_extras->'automacoes') WITH ORDINALITY AS rule(item,position)
  WHERE EXISTS (SELECT 1 FROM modulo_kanban_universal.colunas c WHERE c.tenant_id=NEW.tenant_id AND c.board_id=NEW.board_id AND c.id::text=rule.item->>'colunaId');
  NEW.dados_extras := jsonb_set(NEW.dados_extras,'{automacoes}',rules);
 END IF;
 IF jsonb_typeof(NEW.dados_extras->'seguidores')='array' THEN
  SELECT COALESCE(jsonb_agg(f.item ORDER BY f.position),'[]'::jsonb) INTO followers
  FROM jsonb_array_elements(NEW.dados_extras->'seguidores') WITH ORDINALITY AS f(item,position)
  WHERE EXISTS (SELECT 1 FROM public.usuarios u WHERE u.tenant_id=NEW.tenant_id AND u.id::text=f.item#>>'{}' AND u.ativo
   AND (u.role IN ('DONO','MASTER') OR EXISTS (SELECT 1 FROM modulo_kanban_universal.board_members m WHERE m.tenant_id=NEW.tenant_id AND m.board_id=NEW.board_id AND m.usuario_id=u.id)));
  NEW.dados_extras := jsonb_set(NEW.dados_extras,'{seguidores}',followers);
 END IF;
 IF jsonb_typeof(NEW.dados_extras->'leadId')='string' THEN
  linked := modulo_kanban_universal.resolve_linked_lead(NEW.tenant_id,NEW.dados_extras->>'leadId');
  NEW.dados_extras := jsonb_set(NEW.dados_extras,'{leadId}',COALESCE(to_jsonb(linked),'null'::jsonb));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kanban_normalize_card_references BEFORE INSERT OR UPDATE OF dados_extras ON modulo_kanban_universal.cards
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.normalize_card_references();

CREATE FUNCTION modulo_kanban_universal.clean_board_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE modulo_kanban_universal.cards SET dados_extras=dados_extras,
  responsavel_id=CASE WHEN TG_TABLE_NAME='board_members' AND responsavel_id::text=to_jsonb(OLD)->>'usuario_id' THEN NULL ELSE responsavel_id END
 WHERE tenant_id=OLD.tenant_id AND board_id=OLD.board_id;
 RETURN NULL;
END $$;
CREATE TRIGGER kanban_clean_removed_member AFTER DELETE ON modulo_kanban_universal.board_members
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.clean_board_references();
CREATE TRIGGER kanban_clean_removed_column AFTER DELETE ON modulo_kanban_universal.colunas
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.clean_board_references();

CREATE FUNCTION modulo_kanban_universal.clean_inactive_user_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.ativo AND NOT NEW.ativo THEN
  UPDATE modulo_kanban_universal.cards SET dados_extras=dados_extras,
   responsavel_id=CASE WHEN responsavel_id=NEW.id THEN NULL ELSE responsavel_id END
  WHERE tenant_id=NEW.tenant_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER kanban_clean_inactive_user AFTER UPDATE OF ativo ON public.usuarios
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.clean_inactive_user_references();

-- Mesclar acompanha o principal; lixeira, anonimização e exclusão desfazem o vínculo.
CREATE FUNCTION modulo_kanban_universal.sync_lead_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.deleted_at,NEW.mesclado_em_id,NEW.anonimizado_em) IS DISTINCT FROM (OLD.deleted_at,OLD.mesclado_em_id,OLD.anonimizado_em) THEN
  UPDATE modulo_kanban_universal.cards SET dados_extras=dados_extras
  WHERE tenant_id=OLD.tenant_id AND lower(dados_extras->>'leadId')=OLD.id::text;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER kanban_sync_changed_lead AFTER UPDATE OF deleted_at,mesclado_em_id,anonimizado_em ON modulo_crm.leads
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.sync_lead_references();
CREATE TRIGGER kanban_sync_deleted_lead AFTER DELETE ON modulo_crm.leads
 FOR EACH ROW EXECUTE FUNCTION modulo_kanban_universal.sync_lead_references();

-- Corrige referências já existentes; valores legados não UUID são preservados.
UPDATE modulo_kanban_universal.cards SET dados_extras=dados_extras
WHERE dados_extras ?| ARRAY['leadId','automacoes','seguidores'];
