-- Lead descartado numa mesclagem (M7) é um resto do principal: sem dados,
-- atividades nem histórico (foram pro principal). Com SET NULL, apagar o
-- principal por outro caminho que não a purga (LGPD, script) tiraria a
-- marca do descartado, e "Restaurar" ressuscitaria um lead vazio. Com
-- CASCADE, o descartado sai junto e `mesclado_em_id` nunca fica nulo num
-- lead mesclado.
--
-- Na purga não muda nada: o principal só é purgado no mesmo dia do
-- descartado ou depois (o descartado foi pra lixeira na mesclagem).
ALTER TABLE modulo_crm.leads DROP CONSTRAINT leads_mesclado_em_id_fkey;
ALTER TABLE modulo_crm.leads
  ADD CONSTRAINT leads_mesclado_em_id_fkey
  FOREIGN KEY (mesclado_em_id) REFERENCES modulo_crm.leads(id) ON DELETE CASCADE;
