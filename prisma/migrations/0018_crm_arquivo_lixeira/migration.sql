-- Arquivar e lixeira (docs/crm/plano-configuracoes.md, M5).
--
-- `archived_at`: lead arquivado — sai da lista ativa, continua editável e
-- aparece no filtro "Arquivados".
-- `deleted_at`: lead na lixeira (o "Excluir" virou soft delete) — some de
-- toda leitura, busca, export e deduplicação; pode ser restaurado por 30
-- dias e depois é apagado de vez pelo job diário do worker do CRM.
-- Um lead pode ter os dois: restaurar devolve ele pra onde estava.
ALTER TABLE modulo_crm.leads
  ADD COLUMN archived_at TIMESTAMP,
  ADD COLUMN deleted_at TIMESTAMP;

-- Filtro "Arquivados" (a lista ativa usa os índices de tenant que já existem).
CREATE INDEX idx_leads_arquivados
  ON modulo_crm.leads (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

-- Lixeira e purga (`deleted_at < agora - 30 dias`).
CREATE INDEX idx_leads_lixeira
  ON modulo_crm.leads (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
