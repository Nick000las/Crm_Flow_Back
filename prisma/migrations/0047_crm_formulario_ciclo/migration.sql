-- FM6 (docs/crm/plano-execucao-formularios-forecast.md): LGPD e ciclo de
-- vida da pessoa nos formulários.
--
-- A resposta continua imutável, com duas exceções controladas por GUC,
-- ligado só dentro da transação que precisa dele:
--
-- - `app.form_mesclando = 'on'` (mesclagem): só `lead_id` muda; a resposta
--   do descartado passa para o principal.
-- - `app.lgpd_anonimizando = 'on'` (anonimização, o mesmo GUC do histórico,
--   migration 0028): só os valores pessoais mudam (respostas, nome do
--   responsável, IP e navegador). Formulário, versão, datas, aceite e o
--   relatório de escrita (que não tem valores) ficam.
CREATE OR REPLACE FUNCTION modulo_crm.crm_form_submission_imutavel() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- `ON DELETE SET NULL (deal_id)` da FK.
  IF NEW.deal_id IS NULL AND OLD.deal_id IS NOT NULL
     AND (to_jsonb(NEW) - 'deal_id') = (to_jsonb(OLD) - 'deal_id') THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.form_mesclando', true) = 'on'
     AND (to_jsonb(NEW) - 'lead_id') = (to_jsonb(OLD) - 'lead_id') THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.lgpd_anonimizando', true) = 'on'
     AND (to_jsonb(NEW) - ARRAY['answers', 'guardian_name', 'ip', 'user_agent'])
       = (to_jsonb(OLD) - ARRAY['answers', 'guardian_name', 'ip', 'user_agent']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'crm_form_submission é imutável';
END;
$$;

-- Só as colunas das duas exceções; o trigger confere o resto.
GRANT UPDATE (lead_id, answers, guardian_name, ip, user_agent)
  ON modulo_crm.crm_form_submission TO app_tenant;
-- Mesclagem: o alerta acompanha a pessoa.
GRANT UPDATE (lead_id) ON modulo_crm.crm_form_alert TO app_tenant;
