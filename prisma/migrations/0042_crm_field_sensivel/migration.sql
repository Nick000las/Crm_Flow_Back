-- FM1 (docs/crm/plano-execucao-formularios-forecast.md): campo sensível.
-- Pergunta de saúde vira campo personalizado; marcado como sensível, ele
-- nasce oculto para o OPERADOR e sai das colunas padrão do export. A regra
-- fica no service; aqui só a marcação.
ALTER TABLE modulo_crm.crm_field
  ADD COLUMN is_sensitive BOOLEAN NOT NULL DEFAULT false;
