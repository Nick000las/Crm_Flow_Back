-- FC1 (docs/crm/plano-execucao-formularios-forecast.md): probabilidade
-- padrão de cada status, base do forecast ponderado.
--
-- A probabilidade efetiva de uma oportunidade é o `probability_override`
-- dela, se houver, senão a deste status. Status aberto nunca fica sem valor:
-- assim o forecast nunca conta o valor cheio por falta de probabilidade.
-- Ganho e perdido são fixos (100 e 0).
ALTER TABLE modulo_crm.crm_option
  ADD COLUMN default_probability SMALLINT,
  ADD CONSTRAINT chk_crm_option_probabilidade CHECK (default_probability BETWEEN 0 AND 100);

-- O padrão nasce no banco, para todo caminho que cria status (seed das
-- listas, pipeline novo, status criado em Configurações) e para a troca de
-- categoria. Sugestões do documento do dono (1B.1) pela chave; outra chave
-- aberta começa em 10, o lado conservador. Espelhado em
-- `PROBABILIDADE_SUGERIDA` (constants/listas.js), conferido por teste.
CREATE OR REPLACE FUNCTION modulo_crm.crm_option_probabilidade_padrao() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'status' THEN
    RETURN NEW;
  END IF;
  IF NEW.category = 'ganho' THEN
    NEW.default_probability := 100;
  ELSIF NEW.category = 'perdido' THEN
    NEW.default_probability := 0;
  ELSIF NEW.default_probability IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.category <> 'aberto'
         AND NEW.default_probability IS NOT DISTINCT FROM OLD.default_probability) THEN
    NEW.default_probability := CASE NEW.key
      WHEN 'novo' THEN 10
      WHEN 'em_contato' THEN 20
      WHEN 'qualificado' THEN 40
      WHEN 'proposta' THEN 60
      WHEN 'negociacao' THEN 80
      ELSE 10
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crm_option_probabilidade_padrao
  BEFORE INSERT OR UPDATE OF category, default_probability ON modulo_crm.crm_option
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.crm_option_probabilidade_padrao();

-- Os status existentes passam pelo trigger. `updated_at` não muda: preencher
-- o padrão não é uma edição do dono.
UPDATE modulo_crm.crm_option SET default_probability = NULL WHERE kind = 'status';

-- Só depois de preencher: a regra vale para as linhas que já existem.
ALTER TABLE modulo_crm.crm_option
  ADD CONSTRAINT chk_crm_option_probabilidade_status CHECK (
    CASE
      WHEN kind <> 'status' THEN default_probability IS NULL
      WHEN category = 'ganho' THEN default_probability = 100
      WHEN category = 'perdido' THEN default_probability = 0
      ELSE default_probability IS NOT NULL
    END
  );
