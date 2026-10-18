-- Primeiro nome (docs/crm/plano-configuracoes.md, M10).
--
-- Campo do sistema (Camada 1) derivado do Nome — a primeira palavra — e
-- editável, pra personalizar mensagens. Coluna comum (não GENERATED): o
-- usuário pode trocar "Maria" por "Mari". A derivação mora no service
-- (`primeiroNomeDe`, primeiro-nome.service.js); o backfill abaixo usa a
-- mesma regra.
ALTER TABLE modulo_crm.leads
  ADD COLUMN primeiro_nome VARCHAR;

-- Backfill sem tocar `updated_at` (o trigger reordenaria a lista inteira).
ALTER TABLE modulo_crm.leads DISABLE TRIGGER trg_leads_updated_at;

UPDATE modulo_crm.leads
SET primeiro_nome = split_part(regexp_replace(btrim(nome), '\s+', ' ', 'g'), ' ', 1)
WHERE primeiro_nome IS NULL AND btrim(nome) <> '';

ALTER TABLE modulo_crm.leads ENABLE TRIGGER trg_leads_updated_at;
