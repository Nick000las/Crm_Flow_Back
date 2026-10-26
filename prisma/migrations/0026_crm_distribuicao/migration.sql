-- Distribuição automática de leads (docs/crm/plano-configuracoes.md, M12).
--
-- Lead novo sem responsável é atribuído pela primeira regra que casar
-- (usuário ou rodízio de um grupo), ou pelo fallback da configuração.
-- Todas tenant-scoped (RLS); o `app_tenant` recebe acesso pelos default
-- privileges de `modulo_crm` (migration 0004).

-- Grupos de usuários (destino de regra, distribuído em rodízio).
CREATE TABLE modulo_crm.crm_user_group (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX crm_user_group_nome_key ON modulo_crm.crm_user_group (tenant_id, lower(nome));

CREATE TABLE modulo_crm.crm_user_group_member (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grupo_id UUID NOT NULL REFERENCES modulo_crm.crm_user_group(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (grupo_id, usuario_id)
);
CREATE INDEX crm_user_group_member_tenant_idx ON modulo_crm.crm_user_group_member (tenant_id);

-- Regras, em ordem (`posicao`). `condicoes`: `[{ campoId, operador, valor? }]`
-- combinadas com E (vazio = casa com tudo) — `campoId` sem FK, como nas
-- regras do M8: campo excluído faz a regra não casar. Destino: usuário OU
-- grupo. Grupo em uso não pode ser excluído (RESTRICT; o service avisa antes).
CREATE TABLE modulo_crm.crm_assignment_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR NOT NULL,
  posicao INT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  condicoes JSONB NOT NULL DEFAULT '[]',
  destino_usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  destino_grupo_id UUID REFERENCES modulo_crm.crm_user_group(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT crm_assignment_rule_um_destino CHECK ((destino_usuario_id IS NULL) <> (destino_grupo_id IS NULL))
);
CREATE INDEX crm_assignment_rule_tenant_posicao_idx ON modulo_crm.crm_assignment_rule (tenant_id, posicao);

-- Sem linha = distribuição desligada (o criador vira o responsável, como antes).
CREATE TABLE modulo_crm.crm_distribuicao_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT false,
  fallback VARCHAR NOT NULL DEFAULT 'rodizio_geral' CHECK (fallback IN ('rodizio_geral', 'sem_responsavel')),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ponteiro do rodízio: quem recebeu por último, por grupo (`chave` = id do
-- grupo) ou no rodízio geral (`chave` = 'geral'). Travado com FOR UPDATE
-- na escolha — serializa criações simultâneas.
CREATE TABLE modulo_crm.crm_rodizio_ponteiro (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave VARCHAR NOT NULL,
  ultimo_usuario_id UUID,
  PRIMARY KEY (tenant_id, chave)
);

-- A regra que atribuiu o lead (nulo: manual, fallback ou regra excluída).
ALTER TABLE modulo_crm.leads
  ADD COLUMN assigned_by_rule_id UUID REFERENCES modulo_crm.crm_assignment_rule(id) ON DELETE SET NULL;

ALTER TABLE modulo_crm.crm_user_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_user_group
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_user_group_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_user_group_member
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_assignment_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_assignment_rule
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_distribuicao_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_distribuicao_config
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_rodizio_ponteiro ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_rodizio_ponteiro
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
