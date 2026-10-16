-- Fuso horário do tenant (docs/plano-crm-configuracoes.md, M0.3): base
-- pra jobs agendados "às 8h do cliente" (ex: notificação de lead
-- esfriando, M9). Nome IANA, validado na aplicação (Intl). Aditiva: todo
-- tenant existente recebe o padrão.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS fuso_horario VARCHAR NOT NULL DEFAULT 'America/Sao_Paulo';
