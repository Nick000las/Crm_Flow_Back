-- Atividades e histórico do lead (docs/crm/plano-configuracoes.md, M6).

-- Atividade: ligação, reunião, tarefa... `tipo` é a key de uma opção da
-- lista `tipo_atividade` (crm_option, M3) — sem FK, como status/origem do
-- lead. Concluir uma atividade atualiza `leads.ultima_interacao_em`.
CREATE TABLE modulo_crm.crm_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  tipo VARCHAR NOT NULL,
  titulo VARCHAR NOT NULL,
  notas TEXT,
  agendada_para TIMESTAMP,
  concluida_em TIMESTAMP,
  autor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_crm.crm_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_activity
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_activity_lead ON modulo_crm.crm_activity (tenant_id, lead_id, created_at DESC);
-- Agendadas em aberto: "atividade agendada pausa a inatividade" (M8).
CREATE INDEX idx_crm_activity_agendadas
  ON modulo_crm.crm_activity (tenant_id, agendada_para)
  WHERE concluida_em IS NULL AND agendada_para IS NOT NULL;
-- Contagem de uso da opção de tipo (excluir opção em uso → 409).
CREATE INDEX idx_crm_activity_tipo ON modulo_crm.crm_activity (tenant_id, tipo);

-- Evento do lead: o que mudou, quem mudou e quando. Append-only: o
-- conteúdo nunca muda. Só `lead_id` pode mudar (a mesclagem do M7 move o
-- histórico do lead descartado) e `autor_id` virar NULL (usuário
-- removido). O DELETE é permitido porque o evento
-- segue o lead: a purga da lixeira (M5) apaga em cascata.
--
-- Não reaproveita `audit_log` do core: lá o DELETE é bloqueado por trigger
-- (impediria a purga) e o formato é de ação administrativa, não de diff.
CREATE TABLE modulo_crm.crm_lead_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  -- 'criado', 'atualizado', 'arquivado', 'desarquivado', 'excluido', 'restaurado'
  -- (lista em constants/historico.js; sem CHECK pra tipo novo não exigir migration).
  tipo VARCHAR NOT NULL,
  -- NULL = sistema (job, import).
  autor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  -- Só os campos alterados: [{ campo, campoId?, antes, depois }].
  diff JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_crm.crm_lead_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_lead_event
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_lead_event_lead ON modulo_crm.crm_lead_event (tenant_id, lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION modulo_crm.bloquear_edicao_evento()
RETURNS TRIGGER AS $$
BEGIN
  -- `autor_id` pode virar NULL: é o ON DELETE SET NULL de quando o usuário sai.
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.diff, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.diff, OLD.created_at)
     OR (NEW.autor_id IS NOT NULL AND NEW.autor_id IS DISTINCT FROM OLD.autor_id) THEN
    RAISE EXCEPTION 'crm_lead_event é append-only: só lead_id pode mudar (mesclagem)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_crm_lead_event_append_only
  BEFORE UPDATE ON modulo_crm.crm_lead_event
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.bloquear_edicao_evento();
