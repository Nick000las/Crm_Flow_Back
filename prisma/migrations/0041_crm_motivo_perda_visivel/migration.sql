-- P0 do plano de formulários: "Motivo da perda" passa a nascer ligado
-- (`CAMADA_2_VISIVEIS_POR_PADRAO`). Desligado, a regra do sistema
-- `motivo_perda_em_perdido` some e Perdido aceita oportunidade sem motivo.
--
-- Liga o campo também nos tenants que já existem. Isso sobrescreve uma
-- escolha do tenant, e só é seguro porque ainda não há produção: todos os
-- tenants são de dev e nasceram com o campo desligado pelo padrão antigo.
UPDATE modulo_crm.crm_field_visibility AS v
SET visible = true
FROM modulo_crm.crm_field AS f
WHERE f.id = v.field_id
  AND f.tenant_id = v.tenant_id
  AND f.system_key = 'motivoPerda'
  AND v.visible = false;
