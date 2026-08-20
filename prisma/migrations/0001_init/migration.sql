-- =============================================================================
-- CRMFlow — Schema PostgreSQL Completo
-- Plataforma SwaS B2B (CRM + Omnichannel + IA), multi-tenant com RLS.
-- Baseado no MASTER_DOCUMENT v2.4. Idempotente (pode rodar múltiplas vezes).
--
-- Requisitos: PostgreSQL 14+ com extensões pgcrypto e vector (pgvector).
-- No Neon, ambas estão disponíveis nativamente.
--
-- Convenção de RLS: toda tabela com tenant_id filtra por
--   current_setting('app.current_tenant', true)::uuid
-- setado pelo gateway multi-tenant (getTenantClient) via SET LOCAL.
--
-- ⚠️  REQUISITO OPERACIONAL CRÍTICO (validado em teste):
--   O RLS é IGNORADO por superusuário e pelo OWNER das tabelas. Portanto, a
--   aplicação DEVE conectar ao banco com um role dedicado, NÃO-superusuário e
--   NÃO-owner (ex: role "app_user" com apenas SELECT/INSERT/UPDATE/DELETE).
--   Migrations e provisionamento de tenant rodam com o role owner/admin (que
--   burla RLS de propósito — necessário pra criar tenant novo). No Neon, crie
--   um role de aplicação separado do role de migração. Se a aplicação conectar
--   como owner, TODO o isolamento entre tenants é silenciosamente anulado.
-- =============================================================================

-- =============================================================================
-- BLOCO DE RESET (DESTRUTIVO) — descomente APENAS em desenvolvimento.
-- Apaga TODOS os schemas de módulo e o dado do core. NUNCA rodar em produção.
-- =============================================================================
-- DROP SCHEMA IF EXISTS modulo_crm CASCADE;
-- DROP SCHEMA IF EXISTS modulo_kanban_universal CASCADE;
-- DROP SCHEMA IF EXISTS modulo_atendimento CASCADE;
-- DROP SCHEMA IF EXISTS modulo_ia CASCADE;
-- DROP SCHEMA IF EXISTS modulo_agendamento CASCADE;
-- DROP SCHEMA IF EXISTS modulo_pagamento_inchat CASCADE;
-- DROP SCHEMA IF EXISTS modulo_assessor CASCADE;
-- DROP SCHEMA IF EXISTS modulo_estetica_capilar CASCADE;
-- DROP SCHEMA IF EXISTS modulo_tatuagem CASCADE;
-- DROP TABLE IF EXISTS audit_log, quality_rating_history,
--   payment_webhook_events, cobrancas, assinaturas,
--   wallet_ledger, wallets, tenant_module_features, tenant_modules,
--   usuarios, tenants CASCADE;

-- =============================================================================
-- EXTENSÕES
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (RAG / busca semântica)
CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE constraints com igualdade + range

-- =============================================================================
-- FUNÇÃO COMPARTILHADA — atualização automática de updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Helper: aplica RLS de isolamento por tenant de forma idempotente.
-- (Chamado inline abaixo por tabela — PostgreSQL não permite loop dinâmico simples
--  para políticas, então cada tabela declara sua policy explicitamente.)

-- =============================================================================
-- ███ CORE (schema public) ███
-- =============================================================================

-- ── Tenants ──────────────────────────────────────────────────────────────────
-- status: máquina de estados de assinatura (Bloco 1.3.1)
CREATE TABLE IF NOT EXISTS tenants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  VARCHAR NOT NULL,
  subdomain             VARCHAR NOT NULL UNIQUE,
  dominio_customizado   VARCHAR UNIQUE,                       -- Tier Premium (Bloco 1.1)
  status                VARCHAR NOT NULL DEFAULT 'trial'
                          CHECK (status IN ('trial','active','past_due','suspenso','cancelado')),
  tema_json             JSONB DEFAULT '{}',                  -- cores/logo/terminologia (Camaleão, Bloco 4.1)
  byok                  BOOLEAN NOT NULL DEFAULT FALSE,      -- Bring Your Own Key (Bloco 1.3.2)
  data_region           VARCHAR DEFAULT 'sa-east-1',         -- residência de dados (Bloco 8.8)
  retencao_conversa_meses INTEGER DEFAULT 18,                -- teto de retenção (Bloco 2.4)
  cancelado_em          TIMESTAMP,                           -- início da janela de offboarding (Bloco 2.4)
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- tenants NÃO tem RLS: é a tabela raiz que define os tenants.

-- ── Usuários (auth, MFA, RBAC) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome         VARCHAR NOT NULL,
  email        VARCHAR NOT NULL,
  senha_hash   VARCHAR NOT NULL,
  role         VARCHAR NOT NULL DEFAULT 'OPERADOR'
                 CHECK (role IN ('MASTER','DONO','OPERADOR')),  -- RBAC (Bloco 8.2)
  mfa_ativo    BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret   VARCHAR,                                         -- custodiado cifrado (Bloco 2.2)
  presenca     VARCHAR DEFAULT 'offline'
                 CHECK (presenca IN ('online','pausa','offline')), -- roteamento por presença (Bloco 1.4)
  ativo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant_id ON usuarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usuarios;
CREATE POLICY tenant_isolation ON usuarios
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Módulos ativos por tenant (Bloco 1.1.1) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_modules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key   VARCHAR NOT NULL,          -- 'crm', 'estetica_capilar', ...
  preco_mensal_centavos INTEGER,          -- preço por módulo, calibrado por nicho
  config_jsonb JSONB DEFAULT '{}',        -- config maleável (webhook n8n, etc.) — Bloco 5.4
  enabled_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disabled_at  TIMESTAMP,                 -- soft-disable, dado retido (Bloco 1.1.4)
  UNIQUE (tenant_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant ON tenant_modules(tenant_id);
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_modules;
CREATE POLICY tenant_isolation ON tenant_modules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Feature flags por módulo (Bloco 1.1.2) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_module_features (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key   VARCHAR NOT NULL,
  feature_key  VARCHAR NOT NULL,          -- 'estetica_capilar.resumo_ia_paciente', ...
  enabled_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, module_key, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_tmf_tenant ON tenant_module_features(tenant_id);
ALTER TABLE tenant_module_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_module_features;
CREATE POLICY tenant_isolation ON tenant_module_features
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ BILLING / ASSINATURA (Bloco 1.3.1) ███
-- Fluxo distinto da Wallet de consumo. Máquina de estados em tenants.status.
-- =============================================================================

CREATE TABLE IF NOT EXISTS assinaturas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gateway            VARCHAR NOT NULL,          -- 'pagarme' | 'asaas' | 'mercadopago'
  gateway_subscription_id VARCHAR,              -- id da assinatura no gateway
  metodo             VARCHAR NOT NULL DEFAULT 'pix_automatico'
                       CHECK (metodo IN ('pix_automatico','cartao','boleto')),
  valor_mensal_centavos INTEGER NOT NULL,
  dia_cobranca       INTEGER CHECK (dia_cobranca BETWEEN 1 AND 28),
  ativa              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assinaturas_tenant ON assinaturas(tenant_id);
DROP TRIGGER IF EXISTS trg_assinaturas_updated_at ON assinaturas;
CREATE TRIGGER trg_assinaturas_updated_at BEFORE UPDATE ON assinaturas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assinaturas;
CREATE POLICY tenant_isolation ON assinaturas
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Faturas/cobranças da mensalidade
CREATE TABLE IF NOT EXISTS cobrancas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assinatura_id      UUID REFERENCES assinaturas(id) ON DELETE SET NULL,
  valor_centavos     INTEGER NOT NULL,
  status             VARCHAR NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente','paga','falhou','estornada')),
  gateway_charge_id  VARCHAR,
  vencimento         DATE NOT NULL,
  pago_em            TIMESTAMP,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cobrancas_tenant ON cobrancas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_tenant_status ON cobrancas(tenant_id, status);
DROP TRIGGER IF EXISTS trg_cobrancas_updated_at ON cobrancas;
CREATE TRIGGER trg_cobrancas_updated_at BEFORE UPDATE ON cobrancas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cobrancas;
CREATE POLICY tenant_isolation ON cobrancas
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Eventos de webhook do gateway — idempotência (Bloco 1.3.1)
-- SEM tenant_id: recebido antes de resolver o tenant; processado pelo backend admin.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway        VARCHAR NOT NULL,
  event_id       VARCHAR NOT NULL,          -- id do evento no gateway (dedup)
  event_type     VARCHAR NOT NULL,
  payload        JSONB NOT NULL,
  processado     BOOLEAN NOT NULL DEFAULT FALSE,
  processado_em  TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (gateway, event_id)                -- garante idempotência
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON payment_webhook_events(processado) WHERE processado = FALSE;

-- =============================================================================
-- ███ WALLET DE CONSUMO (Meta/IA) (Bloco 1.3.2) ███
-- Débito atômico obrigatório: UPDATE ... WHERE saldo_centavos >= X
-- =============================================================================

CREATE TABLE IF NOT EXISTS wallets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  saldo_centavos     BIGINT NOT NULL DEFAULT 0 CHECK (saldo_centavos >= 0),
  auto_recarga       BOOLEAN NOT NULL DEFAULT FALSE,
  auto_recarga_valor_centavos INTEGER,
  limite_alerta_pct  INTEGER DEFAULT 10,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_wallets_tenant ON wallets(tenant_id);
DROP TRIGGER IF EXISTS trg_wallets_updated_at ON wallets;
CREATE TRIGGER trg_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wallets;
CREATE POLICY tenant_isolation ON wallets
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Ledger de movimentações (fonte de verdade para reconciliação, Bloco 1.3.2)
-- Separa consumo de PLATAFORMA vs. IA/META mesmo para BYOK (fair use).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wallet_id          UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  tipo               VARCHAR NOT NULL
                       CHECK (tipo IN ('recarga','debito_meta','debito_ia','debito_plataforma','estorno')),
  valor_centavos     BIGINT NOT NULL,       -- positivo=crédito, negativo=débito
  descricao          VARCHAR,
  referencia_externa VARCHAR,               -- id da mensagem/token para reconciliação
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant_data
  ON wallet_ledger(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tipo
  ON wallet_ledger(tenant_id, tipo, created_at);
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wallet_ledger;
CREATE POLICY tenant_isolation ON wallet_ledger
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ REPUTAÇÃO DO NÚMERO (Quality Rating) — série temporal (Bloco 1.2.1) ███
-- =============================================================================
CREATE TABLE IF NOT EXISTS quality_rating_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id  VARCHAR NOT NULL,
  rating           VARCHAR CHECK (rating IN ('GREEN','YELLOW','RED','UNKNOWN')),
  messaging_tier   VARCHAR,                 -- TIER_250 | TIER_1K | TIER_10K | ...
  captured_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quality_rating_tenant_time
  ON quality_rating_history(tenant_id, phone_number_id, captured_at DESC);
ALTER TABLE quality_rating_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quality_rating_history;
CREATE POLICY tenant_isolation ON quality_rating_history
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ TRILHA DE AUDITORIA APPEND-ONLY (Bloco 8.5) ███
-- Imutabilidade garantida por trigger que bloqueia UPDATE/DELETE.
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id   UUID,                        -- quem fez a ação (pode ser NULL = sistema/IA)
  acao         VARCHAR NOT NULL,            -- 'lead.excluido', 'desconto.aplicado', ...
  entidade     VARCHAR,                     -- tabela/entidade afetada
  entidade_id  UUID,
  detalhes     JSONB DEFAULT '{}',
  ip_origem    INET,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entidade
  ON audit_log(tenant_id, entidade, entidade_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Imutabilidade: bloqueia qualquer UPDATE ou DELETE na trilha.
CREATE OR REPLACE FUNCTION bloquear_modificacao_audit()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only: UPDATE/DELETE não permitido';
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_log;
CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacao_audit();

-- =============================================================================
-- ███ MÓDULO: CRM (modulo_crm) ███
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_crm;

CREATE TABLE IF NOT EXISTS modulo_crm.funil_estagios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome               VARCHAR NOT NULL,
  "order"            INTEGER NOT NULL DEFAULT 0,
  system_stage       VARCHAR,               -- 'novo' | 'ganho' | 'perdido' | NULL
  limite_vacuo_horas INTEGER,               -- alerta de lead apodrecido
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_funil_tenant_order
  ON modulo_crm.funil_estagios(tenant_id, "order");
ALTER TABLE modulo_crm.funil_estagios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_crm.funil_estagios;
CREATE POLICY tenant_isolation ON modulo_crm.funil_estagios
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_crm.leads (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome                   VARCHAR NOT NULL,
  telefone               VARCHAR NOT NULL,
  email                  VARCHAR,
  valor                  NUMERIC,
  funil_estagio_id       UUID REFERENCES modulo_crm.funil_estagios(id) ON DELETE SET NULL,
  usuario_responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  origem                 VARCHAR,           -- 'whatsapp' | 'instagram' | 'manual' | ...
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON modulo_crm.leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_estagio ON modulo_crm.leads(tenant_id, funil_estagio_id);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON modulo_crm.leads(tenant_id, telefone);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at
  ON modulo_crm.leads(updated_at DESC) WHERE funil_estagio_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_leads_updated_at ON modulo_crm.leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON modulo_crm.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_crm.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_crm.leads;
CREATE POLICY tenant_isolation ON modulo_crm.leads
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: ATENDIMENTO / OMNICHANNEL (modulo_atendimento) ███
-- Conversas e mensagens WhatsApp/Instagram, janela de 24h, templates HSM.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_atendimento;

CREATE TABLE IF NOT EXISTS modulo_atendimento.conversas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id                UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  canal                  VARCHAR NOT NULL CHECK (canal IN ('whatsapp','instagram')),
  identificador_externo  VARCHAR NOT NULL,  -- telefone / IG user id
  usuario_atribuido_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  status                 VARCHAR NOT NULL DEFAULT 'aberta'
                           CHECK (status IN ('aberta','pausada','resolvida')),
  modo_ia                VARCHAR NOT NULL DEFAULT 'shadow'
                           CHECK (modo_ia IN ('shadow','autopilot','desativado')), -- Bloco 6.1
  janela_24h_expira_em   TIMESTAMP,         -- controle de janela de serviço (Bloco 1.2)
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversas_tenant ON modulo_atendimento.conversas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversas_tenant_status
  ON modulo_atendimento.conversas(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_conversas_atribuido
  ON modulo_atendimento.conversas(tenant_id, usuario_atribuido_id);
DROP TRIGGER IF EXISTS trg_conversas_updated_at ON modulo_atendimento.conversas;
CREATE TRIGGER trg_conversas_updated_at BEFORE UPDATE ON modulo_atendimento.conversas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_atendimento.conversas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_atendimento.conversas;
CREATE POLICY tenant_isolation ON modulo_atendimento.conversas
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_atendimento.mensagens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversa_id    UUID NOT NULL REFERENCES modulo_atendimento.conversas(id) ON DELETE CASCADE,
  lead_id        UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  usuario_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL, -- NULL = cliente ou IA
  direcao        VARCHAR NOT NULL CHECK (direcao IN ('entrada','saida')),
  tipo           VARCHAR NOT NULL DEFAULT 'texto'
                   CHECK (tipo IN ('texto','imagem','audio','documento','template')),
  tipo_envio     VARCHAR CHECK (tipo_envio IN ('manual','ia','automacao','template_hsm')),
  conteudo       TEXT,
  midia_url      VARCHAR,
  transcricao    TEXT,                      -- áudio transcrito (diferencial, Visão 360)
  status_entrega VARCHAR DEFAULT 'enviado'
                   CHECK (status_entrega IN ('enviado','entregue','lido','falhou')),
  external_id    VARCHAR,                   -- id da mensagem na Meta
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mensagens_tenant_conversa
  ON modulo_atendimento.mensagens(tenant_id, conversa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mensagens_tenant_lead
  ON modulo_atendimento.mensagens(tenant_id, lead_id, created_at);
ALTER TABLE modulo_atendimento.mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_atendimento.mensagens;
CREATE POLICY tenant_isolation ON modulo_atendimento.mensagens
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_atendimento.templates_hsm (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome           VARCHAR NOT NULL,
  categoria      VARCHAR,                   -- 'marketing' | 'utility' | 'authentication'
  idioma         VARCHAR DEFAULT 'pt_BR',
  corpo          TEXT NOT NULL,
  status_meta    VARCHAR DEFAULT 'pendente', -- aprovado/rejeitado pela Meta
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, nome, idioma)
);
DROP TRIGGER IF EXISTS trg_templates_updated_at ON modulo_atendimento.templates_hsm;
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON modulo_atendimento.templates_hsm
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_atendimento.templates_hsm ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_atendimento.templates_hsm;
CREATE POLICY tenant_isolation ON modulo_atendimento.templates_hsm
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: KANBAN UNIVERSAL (modulo_kanban_universal) ███
-- Motor parametrizado por board_type — reaproveitado por CRM/projetos/etc (Bloco 1.6.1)
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_kanban_universal;

CREATE TABLE IF NOT EXISTS modulo_kanban_universal.boards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_type  VARCHAR NOT NULL,             -- 'crm_leads' | 'projetos' | 'postagens_agencia'
  nome        VARCHAR NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_boards_tenant ON modulo_kanban_universal.boards(tenant_id);
ALTER TABLE modulo_kanban_universal.boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_kanban_universal.boards;
CREATE POLICY tenant_isolation ON modulo_kanban_universal.boards
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_kanban_universal.colunas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_id    UUID NOT NULL REFERENCES modulo_kanban_universal.boards(id) ON DELETE CASCADE,
  nome        VARCHAR NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_colunas_tenant_board
  ON modulo_kanban_universal.colunas(tenant_id, board_id);
ALTER TABLE modulo_kanban_universal.colunas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_kanban_universal.colunas;
CREATE POLICY tenant_isolation ON modulo_kanban_universal.colunas
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_kanban_universal.cards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_id       UUID NOT NULL REFERENCES modulo_kanban_universal.boards(id) ON DELETE CASCADE,
  coluna_id      UUID NOT NULL REFERENCES modulo_kanban_universal.colunas(id),
  titulo         VARCHAR NOT NULL,
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  dados_extras   JSONB DEFAULT '{}',        -- schema varia por board_type (Bloco 1.1.1)
  "order"        INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cards_tenant_board
  ON modulo_kanban_universal.cards(tenant_id, board_id, coluna_id);
DROP TRIGGER IF EXISTS trg_cards_updated_at ON modulo_kanban_universal.cards;
CREATE TRIGGER trg_cards_updated_at BEFORE UPDATE ON modulo_kanban_universal.cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_kanban_universal.cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_kanban_universal.cards;
CREATE POLICY tenant_isolation ON modulo_kanban_universal.cards
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_kanban_universal.card_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_id     UUID NOT NULL REFERENCES modulo_kanban_universal.cards(id) ON DELETE CASCADE,
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  conteudo    TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_card_comments_tenant_card
  ON modulo_kanban_universal.card_comments(tenant_id, card_id);
ALTER TABLE modulo_kanban_universal.card_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_kanban_universal.card_comments;
CREATE POLICY tenant_isolation ON modulo_kanban_universal.card_comments
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: IA / RAG (modulo_ia) ███
-- Embeddings por tenant (pgvector), Visão 360, dataset harvesting, manipulação, uso LLM.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_ia;

-- Base de RAG específica do tenant (atendimento ao consumidor final)
CREATE TABLE IF NOT EXISTS modulo_ia.documentos_vetores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titulo       VARCHAR,
  conteudo     TEXT NOT NULL,
  embedding    vector(1536),                -- dimensão do modelo de embedding
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_docvetores_tenant ON modulo_ia.documentos_vetores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_docvetores_embedding
  ON modulo_ia.documentos_vetores USING ivfflat (embedding vector_cosine_ops);
ALTER TABLE modulo_ia.documentos_vetores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_ia.documentos_vetores;
CREATE POLICY tenant_isolation ON modulo_ia.documentos_vetores
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Visão 360° pré-computada em JSONB (Bloco 1.6.3)
CREATE TABLE IF NOT EXISTS modulo_ia.customer_summary (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  resumo       JSONB NOT NULL DEFAULT '{}',
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, lead_id)
);
ALTER TABLE modulo_ia.customer_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_ia.customer_summary;
CREATE POLICY tenant_isolation ON modulo_ia.customer_summary
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Dataset harvesting — OPT-IN com anonimização (Bloco 8.7)
CREATE TABLE IF NOT EXISTS modulo_ia.dataset_harvesting (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conteudo_anonimizado TEXT NOT NULL,
  categoria     VARCHAR,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE modulo_ia.dataset_harvesting ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_ia.dataset_harvesting;
CREATE POLICY tenant_isolation ON modulo_ia.dataset_harvesting
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Detecção de manipulação da IA (Bloco 6.2)
CREATE TABLE IF NOT EXISTS modulo_ia.manipulation_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversa_id   UUID REFERENCES modulo_atendimento.conversas(id) ON DELETE CASCADE,
  tipo_alerta   VARCHAR NOT NULL,           -- 'prompt_injection' | 'jailbreak' | ...
  trecho        TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_manip_tenant ON modulo_ia.manipulation_flags(tenant_id, created_at DESC);
ALTER TABLE modulo_ia.manipulation_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_ia.manipulation_flags;
CREATE POLICY tenant_isolation ON modulo_ia.manipulation_flags
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Consumo de LLM por tenant (dashboard de custo, Bloco 6.4)
CREATE TABLE IF NOT EXISTS modulo_ia.llm_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      VARCHAR NOT NULL,           -- 'groq' | 'openai' | ...
  modelo        VARCHAR NOT NULL,
  tokens_input  INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  custo_centavos NUMERIC,
  conversa_id   UUID,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_tenant_time
  ON modulo_ia.llm_usage(tenant_id, created_at DESC);
ALTER TABLE modulo_ia.llm_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_ia.llm_usage;
CREATE POLICY tenant_isolation ON modulo_ia.llm_usage
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: AGENDAMENTO (modulo_agendamento) ███
-- Link de uso único, disponibilidade sob demanda (Bloco 1.6.2).
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_agendamento;

CREATE TABLE IF NOT EXISTS modulo_agendamento.disponibilidades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia_semana   INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio  TIME NOT NULL,
  hora_fim     TIME NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_disp_tenant_user
  ON modulo_agendamento.disponibilidades(tenant_id, usuario_id);
ALTER TABLE modulo_agendamento.disponibilidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_agendamento.disponibilidades;
CREATE POLICY tenant_isolation ON modulo_agendamento.disponibilidades
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_agendamento.agendamentos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  lead_id      UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  inicio       TIMESTAMP NOT NULL,
  fim          TIMESTAMP NOT NULL,
  status       VARCHAR NOT NULL DEFAULT 'confirmado'
                 CHECK (status IN ('confirmado','cancelado','concluido','no_show')),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Impede dois agendamentos ativos sobrepostos para o mesmo profissional (Bloco 1.6.2)
  CONSTRAINT no_overlap_agendamento EXCLUDE USING gist (
    tenant_id WITH =,
    usuario_id WITH =,
    tsrange(inicio, fim) WITH &&
  ) WHERE (status = 'confirmado')
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_tenant_inicio
  ON modulo_agendamento.agendamentos(tenant_id, inicio);
DROP TRIGGER IF EXISTS trg_agendamentos_updated_at ON modulo_agendamento.agendamentos;
CREATE TRIGGER trg_agendamentos_updated_at BEFORE UPDATE ON modulo_agendamento.agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_agendamento.agendamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_agendamento.agendamentos;
CREATE POLICY tenant_isolation ON modulo_agendamento.agendamentos
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_agendamento.links_uso_unico (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token        VARCHAR NOT NULL UNIQUE,     -- token do link único
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  usado        BOOLEAN NOT NULL DEFAULT FALSE,
  expira_em    TIMESTAMP,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_links_tenant ON modulo_agendamento.links_uso_unico(tenant_id);
ALTER TABLE modulo_agendamento.links_uso_unico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_agendamento.links_uso_unico;
CREATE POLICY tenant_isolation ON modulo_agendamento.links_uso_unico
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: PAGAMENTO IN-CHAT (modulo_pagamento_inchat) ███
-- Checkout conversacional (Pix/cartão/boleto), status vinculável ao Kanban.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_pagamento_inchat;

CREATE TABLE IF NOT EXISTS modulo_pagamento_inchat.cobrancas_inchat (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id        UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  conversa_id    UUID REFERENCES modulo_atendimento.conversas(id) ON DELETE SET NULL,
  valor_centavos INTEGER NOT NULL,
  metodo         VARCHAR NOT NULL CHECK (metodo IN ('pix','cartao','boleto')),
  status         VARCHAR NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','pago','expirado','estornado')),
  gateway_charge_id VARCHAR,
  pago_em        TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cobrinchat_tenant_status
  ON modulo_pagamento_inchat.cobrancas_inchat(tenant_id, status);
DROP TRIGGER IF EXISTS trg_cobrinchat_updated_at ON modulo_pagamento_inchat.cobrancas_inchat;
CREATE TRIGGER trg_cobrinchat_updated_at BEFORE UPDATE ON modulo_pagamento_inchat.cobrancas_inchat
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_pagamento_inchat.cobrancas_inchat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_pagamento_inchat.cobrancas_inchat;
CREATE POLICY tenant_isolation ON modulo_pagamento_inchat.cobrancas_inchat
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- ███ MÓDULO: ASSESSOR ESPECIALIZADO (modulo_assessor) ███
-- EXCEÇÃO: base de conhecimento GLOBAL, SEM tenant_id (Bloco 1.7).
-- Conteúdo consultivo compartilhado por todos os tenants — não é dado de tenant.
-- NÃO tem RLS por design (é conhecimento global, curado, sem PII).
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS modulo_assessor;

CREATE TABLE IF NOT EXISTS modulo_assessor.base_conhecimento_global (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_alvo  VARCHAR,                     -- 'vendas' | 'operacao' | NULL (geral)
  titulo       VARCHAR,
  conteudo     TEXT NOT NULL,
  embedding    vector(1536),
  fonte        VARCHAR,                     -- origem (domínio público / licenciado / próprio)
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assessor_embedding
  ON modulo_assessor.base_conhecimento_global USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_assessor_modulo
  ON modulo_assessor.base_conhecimento_global(modulo_alvo);

-- =============================================================================
-- ███ MÓDULOS VERTICAIS (exemplos) ███
-- =============================================================================

-- ── Vertical: Estética Capilar ────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS modulo_estetica_capilar;

CREATE TABLE IF NOT EXISTS modulo_estetica_capilar.pacientes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id            UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  grau_calvicie      VARCHAR,               -- escala Norwood/Ludwig
  data_avaliacao     DATE,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pac_capilar_tenant
  ON modulo_estetica_capilar.pacientes(tenant_id);
DROP TRIGGER IF EXISTS trg_pac_capilar_updated_at ON modulo_estetica_capilar.pacientes;
CREATE TRIGGER trg_pac_capilar_updated_at BEFORE UPDATE ON modulo_estetica_capilar.pacientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_estetica_capilar.pacientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_estetica_capilar.pacientes;
CREATE POLICY tenant_isolation ON modulo_estetica_capilar.pacientes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_estetica_capilar.fotos_evolucao (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id  UUID NOT NULL REFERENCES modulo_estetica_capilar.pacientes(id) ON DELETE CASCADE,
  url          VARCHAR NOT NULL,
  momento      VARCHAR,                     -- 'antes' | 'pos_30d' | 'pos_6m' | ...
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fotos_capilar_tenant_pac
  ON modulo_estetica_capilar.fotos_evolucao(tenant_id, paciente_id);
ALTER TABLE modulo_estetica_capilar.fotos_evolucao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_estetica_capilar.fotos_evolucao;
CREATE POLICY tenant_isolation ON modulo_estetica_capilar.fotos_evolucao
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Vertical: Tatuagem ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS modulo_tatuagem;

CREATE TABLE IF NOT EXISTS modulo_tatuagem.projetos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id        UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL,
  artista_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  descricao      TEXT,
  parte_corpo    VARCHAR,
  orcamento_centavos INTEGER,
  sinal_centavos INTEGER,
  sinal_pago     BOOLEAN NOT NULL DEFAULT FALSE,
  status         VARCHAR NOT NULL DEFAULT 'orcamento'
                   CHECK (status IN ('orcamento','sinal_pago','agendado','concluido','cancelado')),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tatuagem_tenant_status
  ON modulo_tatuagem.projetos(tenant_id, status);
DROP TRIGGER IF EXISTS trg_tatuagem_updated_at ON modulo_tatuagem.projetos;
CREATE TRIGGER trg_tatuagem_updated_at BEFORE UPDATE ON modulo_tatuagem.projetos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE modulo_tatuagem.projetos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_tatuagem.projetos;
CREATE POLICY tenant_isolation ON modulo_tatuagem.projetos
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE TABLE IF NOT EXISTS modulo_tatuagem.anamnese (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id        UUID NOT NULL REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  alergias       TEXT,
  condicoes_saude TEXT,
  respostas_json JSONB DEFAULT '{}',
  assinada_em    TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_anamnese_tenant_lead
  ON modulo_tatuagem.anamnese(tenant_id, lead_id);
ALTER TABLE modulo_tatuagem.anamnese ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON modulo_tatuagem.anamnese;
CREATE POLICY tenant_isolation ON modulo_tatuagem.anamnese
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- FIM DO SCHEMA
-- =============================================================================
