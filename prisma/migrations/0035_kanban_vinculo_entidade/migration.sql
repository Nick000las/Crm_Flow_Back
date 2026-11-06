-- Vínculo opcional de um card de projeto com um registro de outro módulo
-- (M6, docs/crm/plano-execucao-crm-kanban.md). Guarda só a referência: o nome
-- é lido do módulo dono a cada consulta, nunca copiado. Sem FK entre schemas;
-- órfãos são limpos pela varredura diária do `kanban.worker.js`.
--
-- O trigger `kanban_card_activity` não registra estas colunas: a ação
-- `card.link` grava a própria atividade, sem o id do registro.
ALTER TABLE modulo_kanban_universal.cards
  ADD COLUMN entidade_tipo TEXT,
  ADD COLUMN entidade_id UUID,
  ADD CONSTRAINT cards_vinculo_completo
    CHECK ((entidade_tipo IS NULL) = (entidade_id IS NULL));

CREATE INDEX idx_cards_vinculo ON modulo_kanban_universal.cards (tenant_id, entidade_tipo, entidade_id)
  WHERE entidade_id IS NOT NULL;
