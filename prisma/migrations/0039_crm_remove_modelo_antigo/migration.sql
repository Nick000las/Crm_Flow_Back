-- M2.5, F5: um modelo só. Os campos comerciais moram em `crm_deal` desde a F4, e
-- `funil_estagios` nunca teve linha: as etapas são as opções de status. Esta
-- migration é irreversível.
--
-- A trava abaixo protege os dados: a F4 parou de gravar nessas colunas, então
-- qualquer valor aqui é dado que nunca foi para a oportunidade. Nesse caso, a
-- migration falha em vez de apagar. Migre o dado antes de rodar de novo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM modulo_crm.leads
    WHERE status IS NOT NULL OR valor IS NOT NULL OR funil_estagio_id IS NOT NULL
      OR data_conversao IS NOT NULL OR probabilidade_fechamento IS NOT NULL
      OR data_prevista_fechamento IS NOT NULL OR motivo_perda IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'modulo_crm.leads tem dado comercial fora de crm_deal: migre antes de apagar as colunas';
  END IF;
  IF EXISTS (SELECT 1 FROM modulo_crm.funil_estagios) THEN
    RAISE EXCEPTION 'modulo_crm.funil_estagios tem linhas: migre antes de apagar a tabela';
  END IF;
END $$;

ALTER TABLE modulo_crm.leads
  DROP COLUMN status,
  DROP COLUMN valor,
  DROP COLUMN funil_estagio_id,
  DROP COLUMN data_conversao,
  DROP COLUMN probabilidade_fechamento,
  DROP COLUMN data_prevista_fechamento,
  DROP COLUMN motivo_perda;

DROP TABLE modulo_crm.funil_estagios;
