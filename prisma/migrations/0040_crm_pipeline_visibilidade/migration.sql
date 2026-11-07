-- M3, D4: o dono define quais pipelines o OPERADOR enxerga. Só existem dois
-- papéis nessa regra (OPERADOR e DONO), então uma coluna basta. Todos nascem
-- visíveis: nada muda até o dono ocultar um pipeline.
ALTER TABLE modulo_crm.crm_pipeline
  ADD COLUMN operator_visible BOOLEAN NOT NULL DEFAULT true;
