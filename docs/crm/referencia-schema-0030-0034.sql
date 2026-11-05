-- REFERÊNCIA, NÃO EXECUTAR. Schema `modulo_crm` do banco de dev antigo, extraído do catálogo do
-- Postgres em 2026-11-04, só estrutura e sem dados. Inclui o efeito das migrations abaixo, cujos
-- arquivos não existem em nenhuma ref do Git. É a base para recriá-las na feat_Forms, com números novos.
--   0030_crm_entidade_outbox
--   0031_crm_quadros
--   0032_crm_oportunidades
--   0033_crm_conversao_oportunidades
--   0034_crm_ciclo_de_vida_config

CREATE TABLE modulo_crm."crm_activity" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "tipo" character varying NOT NULL,
  "titulo" character varying NOT NULL,
  "notas" text,
  "agendada_para" timestamp without time zone,
  "concluida_em" timestamp without time zone,
  "autor_id" uuid,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_activity_autor_id_fkey" FOREIGN KEY (autor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT "crm_activity_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  CONSTRAINT "crm_activity_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_activity_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_activity_id_not_null" NOT NULL id,
  CONSTRAINT "crm_activity_lead_id_not_null" NOT NULL lead_id,
  CONSTRAINT "crm_activity_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_activity_tipo_not_null" NOT NULL tipo,
  CONSTRAINT "crm_activity_titulo_not_null" NOT NULL titulo,
  CONSTRAINT "crm_activity_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_activity_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_crm_activity_agendadas ON modulo_crm.crm_activity USING btree (tenant_id, agendada_para) WHERE ((concluida_em IS NULL) AND (agendada_para IS NOT NULL));
CREATE INDEX idx_crm_activity_lead ON modulo_crm.crm_activity USING btree (tenant_id, lead_id, created_at DESC);
CREATE INDEX idx_crm_activity_pausa ON modulo_crm.crm_activity USING btree (tenant_id, lead_id, agendada_para) WHERE ((concluida_em IS NULL) AND (agendada_para IS NOT NULL));
CREATE INDEX idx_crm_activity_tipo ON modulo_crm.crm_activity USING btree (tenant_id, tipo);
ALTER TABLE modulo_crm."crm_activity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_activity" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_assignment_rule" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "nome" character varying NOT NULL,
  "posicao" integer NOT NULL,
  "ativo" boolean DEFAULT true NOT NULL,
  "condicoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "destino_usuario_id" uuid,
  "destino_grupo_id" uuid,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_assignment_rule_um_destino" CHECK (((destino_usuario_id IS NULL) <> (destino_grupo_id IS NULL))),
  CONSTRAINT "crm_assignment_rule_destino_grupo_id_fkey" FOREIGN KEY (destino_grupo_id) REFERENCES modulo_crm.crm_user_group(id) ON DELETE RESTRICT,
  CONSTRAINT "crm_assignment_rule_destino_usuario_id_fkey" FOREIGN KEY (destino_usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT "crm_assignment_rule_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_assignment_rule_ativo_not_null" NOT NULL ativo,
  CONSTRAINT "crm_assignment_rule_condicoes_not_null" NOT NULL condicoes,
  CONSTRAINT "crm_assignment_rule_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_assignment_rule_id_not_null" NOT NULL id,
  CONSTRAINT "crm_assignment_rule_nome_not_null" NOT NULL nome,
  CONSTRAINT "crm_assignment_rule_posicao_not_null" NOT NULL posicao,
  CONSTRAINT "crm_assignment_rule_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_assignment_rule_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_assignment_rule_pkey" PRIMARY KEY (id)
);
CREATE INDEX crm_assignment_rule_tenant_posicao_idx ON modulo_crm.crm_assignment_rule USING btree (tenant_id, posicao);
ALTER TABLE modulo_crm."crm_assignment_rule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_assignment_rule" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_cnpj_cache" (
  "cnpj" character varying(14) NOT NULL,
  "status" character varying NOT NULL,
  "dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provedor" character varying NOT NULL,
  "consultado_em" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_cnpj_cache_status_check" CHECK (((status)::text = ANY ((ARRAY['ok'::character varying, 'nao_encontrado'::character varying])::text[]))),
  CONSTRAINT "crm_cnpj_cache_cnpj_not_null" NOT NULL cnpj,
  CONSTRAINT "crm_cnpj_cache_consultado_em_not_null" NOT NULL consultado_em,
  CONSTRAINT "crm_cnpj_cache_dados_not_null" NOT NULL dados,
  CONSTRAINT "crm_cnpj_cache_provedor_not_null" NOT NULL provedor,
  CONSTRAINT "crm_cnpj_cache_status_not_null" NOT NULL status,
  CONSTRAINT "crm_cnpj_cache_pkey" PRIMARY KEY (cnpj)
);

CREATE TABLE modulo_crm."crm_cnpj_config" (
  "tenant_id" uuid NOT NULL,
  "ativo" boolean DEFAULT true NOT NULL,
  "modo" character varying DEFAULT 'manual'::character varying NOT NULL,
  "sobrescrever" boolean DEFAULT false NOT NULL,
  "mapeamento" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_cnpj_config_modo_check" CHECK (((modo)::text = ANY ((ARRAY['manual'::character varying, 'automatico'::character varying])::text[]))),
  CONSTRAINT "crm_cnpj_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_cnpj_config_ativo_not_null" NOT NULL ativo,
  CONSTRAINT "crm_cnpj_config_mapeamento_not_null" NOT NULL mapeamento,
  CONSTRAINT "crm_cnpj_config_modo_not_null" NOT NULL modo,
  CONSTRAINT "crm_cnpj_config_sobrescrever_not_null" NOT NULL sobrescrever,
  CONSTRAINT "crm_cnpj_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_cnpj_config_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_cnpj_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_cnpj_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_cnpj_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_deal" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "source_deal_id" uuid,
  "title" character varying,
  "status" character varying NOT NULL,
  "status_category" character varying NOT NULL,
  "amount" numeric(14,2),
  "probability_override" smallint,
  "expected_close_date" date,
  "won_at" timestamp without time zone,
  "lost_at" timestamp without time zone,
  "won_at_estimated" boolean DEFAULT false NOT NULL,
  "lost_reason" character varying,
  "owner_id" uuid,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_reopened_at" timestamp without time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "deleted_at" timestamp without time zone,
  CONSTRAINT "chk_crm_deal_amount" CHECK ((amount >= (0)::numeric)),
  CONSTRAINT "chk_crm_deal_datas" CHECK (((((status_category)::text = 'ganho'::text) = (won_at IS NOT NULL)) AND (((status_category)::text = 'perdido'::text) = (lost_at IS NOT NULL)))),
  CONSTRAINT "chk_crm_deal_probability" CHECK (((probability_override >= 0) AND (probability_override <= 100))),
  CONSTRAINT "chk_crm_deal_status_category" CHECK (((status_category)::text = ANY ((ARRAY['aberto'::character varying, 'ganho'::character varying, 'perdido'::character varying])::text[]))),
  CONSTRAINT "crm_deal_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_deal_lead" FOREIGN KEY (tenant_id, lead_id) REFERENCES modulo_crm.leads(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_deal_owner" FOREIGN KEY (tenant_id, owner_id) REFERENCES usuarios(tenant_id, id) ON DELETE SET NULL (owner_id),
  CONSTRAINT "fk_crm_deal_pipeline" FOREIGN KEY (tenant_id, pipeline_id) REFERENCES modulo_crm.crm_pipeline(tenant_id, id),
  CONSTRAINT "fk_crm_deal_source" FOREIGN KEY (tenant_id, source_deal_id) REFERENCES modulo_crm.crm_deal(tenant_id, id) ON DELETE SET NULL (source_deal_id),
  CONSTRAINT "crm_deal_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_deal_custom_fields_not_null" NOT NULL custom_fields,
  CONSTRAINT "crm_deal_id_not_null" NOT NULL id,
  CONSTRAINT "crm_deal_lead_id_not_null" NOT NULL lead_id,
  CONSTRAINT "crm_deal_pipeline_id_not_null" NOT NULL pipeline_id,
  CONSTRAINT "crm_deal_status_category_not_null" NOT NULL status_category,
  CONSTRAINT "crm_deal_status_not_null" NOT NULL status,
  CONSTRAINT "crm_deal_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_deal_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_deal_version_not_null" NOT NULL version,
  CONSTRAINT "crm_deal_won_at_estimated_not_null" NOT NULL won_at_estimated,
  CONSTRAINT "crm_deal_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_deal_tenant_id_id_key" UNIQUE (tenant_id, id)
);
CREATE INDEX idx_crm_deal_ganhas ON modulo_crm.crm_deal USING btree (tenant_id, pipeline_id, won_at) WHERE (((status_category)::text = 'ganho'::text) AND (deleted_at IS NULL));
CREATE INDEX idx_crm_deal_lead ON modulo_crm.crm_deal USING btree (tenant_id, lead_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_crm_deal_previsao ON modulo_crm.crm_deal USING btree (tenant_id, pipeline_id, status_category, expected_close_date) WHERE (deleted_at IS NULL);
CREATE INDEX idx_crm_deal_quadro_status ON modulo_crm.crm_deal USING btree (tenant_id, pipeline_id, status) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_crm_deal_origem_quadro ON modulo_crm.crm_deal USING btree (source_deal_id, pipeline_id) WHERE (source_deal_id IS NOT NULL);
ALTER TABLE modulo_crm."crm_deal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_deal" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE TRIGGER trg_crm_deal_updated_at BEFORE UPDATE ON modulo_crm.crm_deal FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE modulo_crm."crm_distribuicao_config" (
  "tenant_id" uuid NOT NULL,
  "ativo" boolean DEFAULT false NOT NULL,
  "fallback" character varying DEFAULT 'rodizio_geral'::character varying NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_distribuicao_config_fallback_check" CHECK (((fallback)::text = ANY ((ARRAY['rodizio_geral'::character varying, 'sem_responsavel'::character varying])::text[]))),
  CONSTRAINT "crm_distribuicao_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_distribuicao_config_ativo_not_null" NOT NULL ativo,
  CONSTRAINT "crm_distribuicao_config_fallback_not_null" NOT NULL fallback,
  CONSTRAINT "crm_distribuicao_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_distribuicao_config_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_distribuicao_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_distribuicao_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_distribuicao_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_duplicate_rule" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "campo" character varying NOT NULL,
  "acao" character varying NOT NULL,
  "ativo" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_duplicate_rule_acao_check" CHECK (((acao)::text = ANY ((ARRAY['warn'::character varying, 'block'::character varying])::text[]))),
  CONSTRAINT "crm_duplicate_rule_campo_check" CHECK (((campo)::text = ANY ((ARRAY['email'::character varying, 'telefone'::character varying, 'cnpj'::character varying, 'cpf'::character varying])::text[]))),
  CONSTRAINT "crm_duplicate_rule_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_duplicate_rule_acao_not_null" NOT NULL acao,
  CONSTRAINT "crm_duplicate_rule_ativo_not_null" NOT NULL ativo,
  CONSTRAINT "crm_duplicate_rule_campo_not_null" NOT NULL campo,
  CONSTRAINT "crm_duplicate_rule_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_duplicate_rule_id_not_null" NOT NULL id,
  CONSTRAINT "crm_duplicate_rule_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_duplicate_rule_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_duplicate_rule_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_duplicate_rule_tenant_id_campo_key" UNIQUE (tenant_id, campo)
);
ALTER TABLE modulo_crm."crm_duplicate_rule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_duplicate_rule" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_event" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "tipo" character varying NOT NULL,
  "entidade" character varying NOT NULL,
  "entidade_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "processed_at" timestamp without time zone,
  "locked_until" timestamp without time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  CONSTRAINT "crm_event_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_event_attempts_not_null" NOT NULL attempts,
  CONSTRAINT "crm_event_entidade_id_not_null" NOT NULL entidade_id,
  CONSTRAINT "crm_event_entidade_not_null" NOT NULL entidade,
  CONSTRAINT "crm_event_id_not_null" NOT NULL id,
  CONSTRAINT "crm_event_occurred_at_not_null" NOT NULL occurred_at,
  CONSTRAINT "crm_event_payload_not_null" NOT NULL payload,
  CONSTRAINT "crm_event_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_event_tipo_not_null" NOT NULL tipo,
  CONSTRAINT "crm_event_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_crm_event_pendentes ON modulo_crm.crm_event USING btree (tenant_id, occurred_at) WHERE (processed_at IS NULL);
CREATE INDEX idx_crm_event_tenant_ocorrencia ON modulo_crm.crm_event USING btree (tenant_id, occurred_at);
ALTER TABLE modulo_crm."crm_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_event" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE TRIGGER trg_crm_event_append_only BEFORE UPDATE ON modulo_crm.crm_event FOR EACH ROW EXECUTE FUNCTION modulo_crm.bloquear_edicao_crm_event();

CREATE TABLE modulo_crm."crm_field" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "system_key" character varying,
  "chave" character varying NOT NULL,
  "label" character varying NOT NULL,
  "type" character varying NOT NULL,
  "options" jsonb,
  "position" integer DEFAULT 0 NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "entity" character varying DEFAULT 'lead'::character varying NOT NULL,
  CONSTRAINT "chk_crm_field_entity" CHECK (((entity)::text = ANY ((ARRAY['lead'::character varying, 'oportunidade'::character varying])::text[]))),
  CONSTRAINT "crm_field_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_chave_not_null" NOT NULL chave,
  CONSTRAINT "crm_field_entity_not_null" NOT NULL entity,
  CONSTRAINT "crm_field_id_not_null" NOT NULL id,
  CONSTRAINT "crm_field_is_active_not_null" NOT NULL is_active,
  CONSTRAINT "crm_field_is_required_not_null" NOT NULL is_required,
  CONSTRAINT "crm_field_label_not_null" NOT NULL label,
  CONSTRAINT "crm_field_position_not_null" NOT NULL "position",
  CONSTRAINT "crm_field_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_field_type_not_null" NOT NULL type,
  CONSTRAINT "crm_field_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_field_tenant_id_id_key" UNIQUE (tenant_id, id)
);
CREATE INDEX idx_crm_field_tenant_position ON modulo_crm.crm_field USING btree (tenant_id, "position");
CREATE UNIQUE INDEX uq_crm_field_chave_personalizado_ativo ON modulo_crm.crm_field USING btree (tenant_id, entity, chave) WHERE ((system_key IS NULL) AND is_active);
CREATE UNIQUE INDEX uq_crm_field_system_key ON modulo_crm.crm_field USING btree (tenant_id, system_key) WHERE (system_key IS NOT NULL);
ALTER TABLE modulo_crm."crm_field" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_field" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_field_permission" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "role" character varying NOT NULL,
  "access" character varying NOT NULL,
  CONSTRAINT "crm_field_permission_access_check" CHECK (((access)::text = ANY ((ARRAY['edit'::character varying, 'view'::character varying, 'hidden'::character varying])::text[]))),
  CONSTRAINT "crm_field_permission_tenant_id_field_id_fkey" FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_permission_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_permission_access_not_null" NOT NULL access,
  CONSTRAINT "crm_field_permission_field_id_not_null" NOT NULL field_id,
  CONSTRAINT "crm_field_permission_id_not_null" NOT NULL id,
  CONSTRAINT "crm_field_permission_role_not_null" NOT NULL role,
  CONSTRAINT "crm_field_permission_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_field_permission_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_field_permission_field_id_role_key" UNIQUE (field_id, role)
);
CREATE INDEX idx_crm_field_permission_tenant ON modulo_crm.crm_field_permission USING btree (tenant_id);
ALTER TABLE modulo_crm."crm_field_permission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_field_permission" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_field_pipeline" (
  "tenant_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "pipeline_id" uuid NOT NULL,
  CONSTRAINT "crm_field_pipeline_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_field_pipeline_field" FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_field_pipeline_pipeline" FOREIGN KEY (tenant_id, pipeline_id) REFERENCES modulo_crm.crm_pipeline(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_pipeline_field_id_not_null" NOT NULL field_id,
  CONSTRAINT "crm_field_pipeline_pipeline_id_not_null" NOT NULL pipeline_id,
  CONSTRAINT "crm_field_pipeline_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_field_pipeline_pkey" PRIMARY KEY (field_id, pipeline_id)
);
CREATE INDEX idx_crm_field_pipeline_tenant ON modulo_crm.crm_field_pipeline USING btree (tenant_id);
ALTER TABLE modulo_crm."crm_field_pipeline" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_field_pipeline" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_field_rule" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "kind" character varying NOT NULL,
  "condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "effect" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "system_key" character varying,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_field_rule_kind_check" CHECK (((kind)::text = ANY ((ARRAY['required_from_status'::character varying, 'conditional'::character varying])::text[]))),
  CONSTRAINT "crm_field_rule_tenant_id_field_id_fkey" FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_rule_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_rule_condition_not_null" NOT NULL condition,
  CONSTRAINT "crm_field_rule_effect_not_null" NOT NULL effect,
  CONSTRAINT "crm_field_rule_field_id_not_null" NOT NULL field_id,
  CONSTRAINT "crm_field_rule_id_not_null" NOT NULL id,
  CONSTRAINT "crm_field_rule_is_active_not_null" NOT NULL is_active,
  CONSTRAINT "crm_field_rule_kind_not_null" NOT NULL kind,
  CONSTRAINT "crm_field_rule_position_not_null" NOT NULL "position",
  CONSTRAINT "crm_field_rule_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_field_rule_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_crm_field_rule_tenant_field ON modulo_crm.crm_field_rule USING btree (tenant_id, field_id);
CREATE UNIQUE INDEX uq_crm_field_rule_system_key ON modulo_crm.crm_field_rule USING btree (tenant_id, system_key) WHERE (system_key IS NOT NULL);
ALTER TABLE modulo_crm."crm_field_rule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_field_rule" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_field_visibility" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "context" character varying NOT NULL,
  "visible" boolean NOT NULL,
  CONSTRAINT "crm_field_visibility_context_check" CHECK (((context)::text = ANY ((ARRAY['create_form'::character varying, 'detail'::character varying, 'table'::character varying, 'filter'::character varying])::text[]))),
  CONSTRAINT "crm_field_visibility_tenant_id_field_id_fkey" FOREIGN KEY (tenant_id, field_id) REFERENCES modulo_crm.crm_field(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_visibility_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_field_visibility_context_not_null" NOT NULL context,
  CONSTRAINT "crm_field_visibility_field_id_not_null" NOT NULL field_id,
  CONSTRAINT "crm_field_visibility_id_not_null" NOT NULL id,
  CONSTRAINT "crm_field_visibility_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_field_visibility_visible_not_null" NOT NULL visible,
  CONSTRAINT "crm_field_visibility_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_field_visibility_field_id_context_key" UNIQUE (field_id, context)
);
CREATE INDEX idx_crm_field_visibility_tenant ON modulo_crm.crm_field_visibility USING btree (tenant_id);
ALTER TABLE modulo_crm."crm_field_visibility" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_field_visibility" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_filter_views" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "nome" character varying NOT NULL,
  "filtros" jsonb NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_filter_views_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_filter_views_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT "crm_filter_views_filtros_not_null" NOT NULL filtros,
  CONSTRAINT "crm_filter_views_id_not_null" NOT NULL id,
  CONSTRAINT "crm_filter_views_nome_not_null" NOT NULL nome,
  CONSTRAINT "crm_filter_views_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_filter_views_usuario_id_not_null" NOT NULL usuario_id,
  CONSTRAINT "crm_filter_views_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_filter_views_tenant_id_usuario_id_nome_key" UNIQUE (tenant_id, usuario_id, nome)
);
CREATE INDEX idx_crm_filter_views_tenant_usuario ON modulo_crm.crm_filter_views USING btree (tenant_id, usuario_id);
ALTER TABLE modulo_crm."crm_filter_views" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_filter_views" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_layout_config" (
  "tenant_id" uuid NOT NULL,
  "layout" jsonb NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_layout_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_layout_config_layout_not_null" NOT NULL layout,
  CONSTRAINT "crm_layout_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_layout_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_layout_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_layout_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_lead_event" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "tipo" character varying NOT NULL,
  "autor_id" uuid,
  "diff" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "detalhes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "crm_lead_event_autor_id_fkey" FOREIGN KEY (autor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT "crm_lead_event_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  CONSTRAINT "crm_lead_event_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_lead_event_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_lead_event_detalhes_not_null" NOT NULL detalhes,
  CONSTRAINT "crm_lead_event_diff_not_null" NOT NULL diff,
  CONSTRAINT "crm_lead_event_id_not_null" NOT NULL id,
  CONSTRAINT "crm_lead_event_lead_id_not_null" NOT NULL lead_id,
  CONSTRAINT "crm_lead_event_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_lead_event_tipo_not_null" NOT NULL tipo,
  CONSTRAINT "crm_lead_event_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_crm_lead_event_lead ON modulo_crm.crm_lead_event USING btree (tenant_id, lead_id, created_at DESC);
ALTER TABLE modulo_crm."crm_lead_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_lead_event" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE TRIGGER trg_crm_lead_event_append_only BEFORE UPDATE ON modulo_crm.crm_lead_event FOR EACH ROW EXECUTE FUNCTION modulo_crm.bloquear_edicao_evento();

CREATE TABLE modulo_crm."crm_lgpd_config" (
  "tenant_id" uuid NOT NULL,
  "base_legal_padrao" character varying,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "chk_crm_lgpd_config_base" CHECK (((base_legal_padrao)::text = ANY ((ARRAY['consentimento'::character varying, 'legitimo_interesse'::character varying, 'execucao_contrato'::character varying, 'obrigacao_legal'::character varying, 'outra'::character varying])::text[]))),
  CONSTRAINT "crm_lgpd_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_lgpd_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_lgpd_config_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_lgpd_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_lgpd_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_lgpd_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_lifecycle_config" (
  "tenant_id" uuid NOT NULL,
  "labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_lifecycle_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_lifecycle_config_labels_not_null" NOT NULL labels,
  CONSTRAINT "crm_lifecycle_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_lifecycle_config_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_lifecycle_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_lifecycle_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_lifecycle_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE TRIGGER trg_crm_lifecycle_config_updated_at BEFORE UPDATE ON modulo_crm.crm_lifecycle_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE modulo_crm."crm_option" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "kind" character varying NOT NULL,
  "key" character varying NOT NULL,
  "label" character varying NOT NULL,
  "color" character varying,
  "position" integer DEFAULT 0 NOT NULL,
  "category" character varying,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "stale_days" integer,
  "pipeline_id" uuid,
  CONSTRAINT "chk_crm_option_categoria" CHECK ((((kind)::text = 'status'::text) = (category IS NOT NULL))),
  CONSTRAINT "chk_crm_option_pipeline" CHECK (
CASE kind
    WHEN 'status'::text THEN (pipeline_id IS NOT NULL)
    WHEN 'motivo_perda'::text THEN true
    ELSE (pipeline_id IS NULL)
END),
  CONSTRAINT "chk_crm_option_stale_days" CHECK (((stale_days >= 1) AND (stale_days <= 365))),
  CONSTRAINT "chk_crm_option_stale_days_status" CHECK (((stale_days IS NULL) OR ((kind)::text = 'status'::text))),
  CONSTRAINT "crm_option_category_check" CHECK (((category)::text = ANY ((ARRAY['aberto'::character varying, 'ganho'::character varying, 'perdido'::character varying])::text[]))),
  CONSTRAINT "crm_option_color_check" CHECK (((color)::text ~ '^#[0-9a-fA-F]{6}$'::text)),
  CONSTRAINT "crm_option_kind_check" CHECK (((kind)::text = ANY ((ARRAY['status'::character varying, 'fonte_lead'::character varying, 'motivo_perda'::character varying, 'tipo_atividade'::character varying, 'tag'::character varying])::text[]))),
  CONSTRAINT "crm_option_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_option_pipeline" FOREIGN KEY (tenant_id, pipeline_id) REFERENCES modulo_crm.crm_pipeline(tenant_id, id),
  CONSTRAINT "crm_option_id_not_null" NOT NULL id,
  CONSTRAINT "crm_option_is_active_not_null" NOT NULL is_active,
  CONSTRAINT "crm_option_key_not_null" NOT NULL key,
  CONSTRAINT "crm_option_kind_not_null" NOT NULL kind,
  CONSTRAINT "crm_option_label_not_null" NOT NULL label,
  CONSTRAINT "crm_option_position_not_null" NOT NULL "position",
  CONSTRAINT "crm_option_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_option_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_option_tenant_id_id_key" UNIQUE (tenant_id, id),
  CONSTRAINT "uq_crm_option_chave" UNIQUE NULLS NOT DISTINCT (tenant_id, kind, pipeline_id, key)
);
CREATE INDEX idx_crm_option_pipeline ON modulo_crm.crm_option USING btree (tenant_id, pipeline_id, kind, "position") WHERE (pipeline_id IS NOT NULL);
CREATE INDEX idx_crm_option_tenant_kind_position ON modulo_crm.crm_option USING btree (tenant_id, kind, "position");
ALTER TABLE modulo_crm."crm_option" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_option" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_pipeline" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" character varying NOT NULL,
  "type" character varying NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "auto_create_enabled" boolean DEFAULT false NOT NULL,
  "auto_create_from_pipeline_id" uuid,
  "auto_create_initial_status" character varying,
  "auto_create_owner_rule" character varying DEFAULT 'person_owner'::character varying NOT NULL,
  "auto_create_owner_id" uuid,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "chk_crm_pipeline_auto_criacao" CHECK ((((type)::text = 'service'::text) OR ((NOT auto_create_enabled) AND (auto_create_from_pipeline_id IS NULL)))),
  CONSTRAINT "chk_crm_pipeline_owner_rule" CHECK (((auto_create_owner_rule)::text = ANY ((ARRAY['person_owner'::character varying, 'specific_user'::character varying, 'none'::character varying])::text[]))),
  CONSTRAINT "chk_crm_pipeline_padrao" CHECK (((NOT is_default) OR (((type)::text = 'sales'::text) AND is_active))),
  CONSTRAINT "chk_crm_pipeline_type" CHECK (((type)::text = ANY ((ARRAY['sales'::character varying, 'service'::character varying])::text[]))),
  CONSTRAINT "crm_pipeline_auto_create_owner_id_fkey" FOREIGN KEY (auto_create_owner_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT "crm_pipeline_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "fk_crm_pipeline_auto_origem" FOREIGN KEY (tenant_id, auto_create_from_pipeline_id) REFERENCES modulo_crm.crm_pipeline(tenant_id, id),
  CONSTRAINT "crm_pipeline_auto_create_enabled_not_null" NOT NULL auto_create_enabled,
  CONSTRAINT "crm_pipeline_auto_create_owner_rule_not_null" NOT NULL auto_create_owner_rule,
  CONSTRAINT "crm_pipeline_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_pipeline_id_not_null" NOT NULL id,
  CONSTRAINT "crm_pipeline_is_active_not_null" NOT NULL is_active,
  CONSTRAINT "crm_pipeline_is_default_not_null" NOT NULL is_default,
  CONSTRAINT "crm_pipeline_name_not_null" NOT NULL name,
  CONSTRAINT "crm_pipeline_position_not_null" NOT NULL "position",
  CONSTRAINT "crm_pipeline_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_pipeline_type_not_null" NOT NULL type,
  CONSTRAINT "crm_pipeline_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_pipeline_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_pipeline_tenant_id_id_key" UNIQUE (tenant_id, id)
);
CREATE INDEX idx_crm_pipeline_tenant_position ON modulo_crm.crm_pipeline USING btree (tenant_id, "position");
CREATE UNIQUE INDEX uq_crm_pipeline_padrao ON modulo_crm.crm_pipeline USING btree (tenant_id) WHERE is_default;
ALTER TABLE modulo_crm."crm_pipeline" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_pipeline" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_rodizio_ponteiro" (
  "tenant_id" uuid NOT NULL,
  "chave" character varying NOT NULL,
  "ultimo_usuario_id" uuid,
  CONSTRAINT "crm_rodizio_ponteiro_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_rodizio_ponteiro_chave_not_null" NOT NULL chave,
  CONSTRAINT "crm_rodizio_ponteiro_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_rodizio_ponteiro_pkey" PRIMARY KEY (tenant_id, chave)
);
ALTER TABLE modulo_crm."crm_rodizio_ponteiro" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_rodizio_ponteiro" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_score_band" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "chave" character varying NOT NULL,
  "rotulo" character varying NOT NULL,
  "minimo" integer,
  "maximo" integer,
  "cor" character varying NOT NULL,
  "posicao" integer NOT NULL,
  CONSTRAINT "crm_score_band_intervalo" CHECK (((minimo IS NULL) OR (maximo IS NULL) OR (minimo <= maximo))),
  CONSTRAINT "crm_score_band_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_score_band_chave_not_null" NOT NULL chave,
  CONSTRAINT "crm_score_band_cor_not_null" NOT NULL cor,
  CONSTRAINT "crm_score_band_id_not_null" NOT NULL id,
  CONSTRAINT "crm_score_band_posicao_not_null" NOT NULL posicao,
  CONSTRAINT "crm_score_band_rotulo_not_null" NOT NULL rotulo,
  CONSTRAINT "crm_score_band_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_score_band_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_score_band_tenant_id_chave_key" UNIQUE (tenant_id, chave)
);
ALTER TABLE modulo_crm."crm_score_band" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_score_band" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_score_config" (
  "tenant_id" uuid NOT NULL,
  "recalculo_total" integer DEFAULT 0 NOT NULL,
  "recalculo_processados" integer DEFAULT 0 NOT NULL,
  "recalculo_iniciado_em" timestamp without time zone,
  "recalculo_concluido_em" timestamp without time zone,
  CONSTRAINT "crm_score_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_score_config_recalculo_processados_not_null" NOT NULL recalculo_processados,
  CONSTRAINT "crm_score_config_recalculo_total_not_null" NOT NULL recalculo_total,
  CONSTRAINT "crm_score_config_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_score_config_pkey" PRIMARY KEY (tenant_id)
);
ALTER TABLE modulo_crm."crm_score_config" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_score_config" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_score_rule" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "nome" character varying NOT NULL,
  "posicao" integer NOT NULL,
  "ativo" boolean DEFAULT true NOT NULL,
  "condicoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pontos" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_score_rule_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_score_rule_ativo_not_null" NOT NULL ativo,
  CONSTRAINT "crm_score_rule_condicoes_not_null" NOT NULL condicoes,
  CONSTRAINT "crm_score_rule_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_score_rule_id_not_null" NOT NULL id,
  CONSTRAINT "crm_score_rule_nome_not_null" NOT NULL nome,
  CONSTRAINT "crm_score_rule_pontos_not_null" NOT NULL pontos,
  CONSTRAINT "crm_score_rule_posicao_not_null" NOT NULL posicao,
  CONSTRAINT "crm_score_rule_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_score_rule_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_score_rule_pkey" PRIMARY KEY (id)
);
CREATE INDEX crm_score_rule_tenant_posicao_idx ON modulo_crm.crm_score_rule USING btree (tenant_id, posicao);
ALTER TABLE modulo_crm."crm_score_rule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_score_rule" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_user_group" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "nome" character varying NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "crm_user_group_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_group_created_at_not_null" NOT NULL created_at,
  CONSTRAINT "crm_user_group_id_not_null" NOT NULL id,
  CONSTRAINT "crm_user_group_nome_not_null" NOT NULL nome,
  CONSTRAINT "crm_user_group_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_user_group_updated_at_not_null" NOT NULL updated_at,
  CONSTRAINT "crm_user_group_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX crm_user_group_nome_key ON modulo_crm.crm_user_group USING btree (tenant_id, lower((nome)::text));
ALTER TABLE modulo_crm."crm_user_group" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_user_group" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_user_group_member" (
  "tenant_id" uuid NOT NULL,
  "grupo_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  CONSTRAINT "crm_user_group_member_grupo_id_fkey" FOREIGN KEY (grupo_id) REFERENCES modulo_crm.crm_user_group(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_group_member_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_group_member_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_group_member_grupo_id_not_null" NOT NULL grupo_id,
  CONSTRAINT "crm_user_group_member_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_user_group_member_usuario_id_not_null" NOT NULL usuario_id,
  CONSTRAINT "crm_user_group_member_pkey" PRIMARY KEY (grupo_id, usuario_id)
);
CREATE INDEX crm_user_group_member_tenant_idx ON modulo_crm.crm_user_group_member USING btree (tenant_id);
ALTER TABLE modulo_crm."crm_user_group_member" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_user_group_member" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."crm_user_layout_override" (
  "tenant_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "layout" jsonb NOT NULL,
  "padrao_visto" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_user_layout_override_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_layout_override_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT "crm_user_layout_override_layout_not_null" NOT NULL layout,
  CONSTRAINT "crm_user_layout_override_padrao_visto_not_null" NOT NULL padrao_visto,
  CONSTRAINT "crm_user_layout_override_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "crm_user_layout_override_usuario_id_not_null" NOT NULL usuario_id,
  CONSTRAINT "crm_user_layout_override_pkey" PRIMARY KEY (tenant_id, usuario_id)
);
ALTER TABLE modulo_crm."crm_user_layout_override" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."crm_user_layout_override" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."import_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "status" character varying DEFAULT 'pendente'::character varying NOT NULL,
  "estrategia_duplicata" character varying NOT NULL,
  "payload" jsonb NOT NULL,
  "total_linhas" integer NOT NULL,
  "linhas_processadas" integer DEFAULT 0 NOT NULL,
  "linhas_criadas" integer DEFAULT 0 NOT NULL,
  "linhas_atualizadas" integer DEFAULT 0 NOT NULL,
  "linhas_ignoradas" integer DEFAULT 0 NOT NULL,
  "linhas_com_erro" integer DEFAULT 0 NOT NULL,
  "relatorio_erro" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "concluido_em" timestamp without time zone,
  "acoes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "oportunidade_existente" character varying DEFAULT 'atualizar_principal'::character varying NOT NULL,
  CONSTRAINT "chk_import_jobs_oportunidade_existente" CHECK (((oportunidade_existente)::text = ANY ((ARRAY['atualizar_principal'::character varying, 'criar_nova'::character varying])::text[]))),
  CONSTRAINT "import_jobs_estrategia_duplicata_check" CHECK (((estrategia_duplicata)::text = ANY ((ARRAY['pular'::character varying, 'atualizar'::character varying, 'criar'::character varying])::text[]))),
  CONSTRAINT "import_jobs_status_check" CHECK (((status)::text = ANY ((ARRAY['pendente'::character varying, 'processando'::character varying, 'concluido'::character varying, 'falhou'::character varying])::text[]))),
  CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT "import_jobs_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT "import_jobs_acoes_not_null" NOT NULL acoes,
  CONSTRAINT "import_jobs_estrategia_duplicata_not_null" NOT NULL estrategia_duplicata,
  CONSTRAINT "import_jobs_id_not_null" NOT NULL id,
  CONSTRAINT "import_jobs_linhas_atualizadas_not_null" NOT NULL linhas_atualizadas,
  CONSTRAINT "import_jobs_linhas_com_erro_not_null" NOT NULL linhas_com_erro,
  CONSTRAINT "import_jobs_linhas_criadas_not_null" NOT NULL linhas_criadas,
  CONSTRAINT "import_jobs_linhas_ignoradas_not_null" NOT NULL linhas_ignoradas,
  CONSTRAINT "import_jobs_linhas_processadas_not_null" NOT NULL linhas_processadas,
  CONSTRAINT "import_jobs_oportunidade_existente_not_null" NOT NULL oportunidade_existente,
  CONSTRAINT "import_jobs_payload_not_null" NOT NULL payload,
  CONSTRAINT "import_jobs_relatorio_erro_not_null" NOT NULL relatorio_erro,
  CONSTRAINT "import_jobs_status_not_null" NOT NULL status,
  CONSTRAINT "import_jobs_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "import_jobs_total_linhas_not_null" NOT NULL total_linhas,
  CONSTRAINT "import_jobs_usuario_id_not_null" NOT NULL usuario_id,
  CONSTRAINT "import_jobs_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_import_jobs_tenant_status ON modulo_crm.import_jobs USING btree (tenant_id, status);
ALTER TABLE modulo_crm."import_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."import_jobs" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

CREATE TABLE modulo_crm."leads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "nome" character varying NOT NULL,
  "telefone" character varying,
  "usuario_responsavel_id" uuid,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "email" character varying,
  "fonte_lead" character varying,
  "tags" character varying[],
  "ultima_interacao_em" timestamp without time zone,
  "empresa" character varying,
  "cargo" character varying,
  "cpf" character varying,
  "cnpj" character varying,
  "cidade" character varying,
  "uf" character varying,
  "cep" character varying,
  "endereco" character varying,
  "campanha_utm" character varying,
  "lead_score" numeric,
  "proximo_followup" timestamp without time zone,
  "archived_at" timestamp without time zone,
  "deleted_at" timestamp without time zone,
  "dedup_email" text GENERATED ALWAYS AS (NULLIF(lower(btrim((email)::text)), ''::text)) STORED,
  "dedup_telefone" text GENERATED ALWAYS AS (modulo_crm.chave_telefone((telefone)::text)) STORED,
  "dedup_cnpj" text GENERATED ALWAYS AS (modulo_crm.chave_documento((cnpj)::text)) STORED,
  "dedup_cpf" text GENERATED ALWAYS AS (modulo_crm.chave_documento((cpf)::text)) STORED,
  "mesclado_em_id" uuid,
  "primeiro_nome" character varying,
  "assigned_by_rule_id" uuid,
  "legal_basis" character varying,
  "legal_basis_at" timestamp without time zone,
  "origem_registro" character varying,
  "marketing_opt_out_at" timestamp without time zone,
  "anonimizado_em" timestamp without time zone,
  "lifecycle_stage" character varying DEFAULT 'lead'::character varying NOT NULL,
  "lifecycle_changed_at" timestamp without time zone,
  "first_won_at" timestamp without time zone,
  "last_won_at" timestamp without time zone,
  "open_deals_count" integer DEFAULT 0 NOT NULL,
  "won_deals_count" integer DEFAULT 0 NOT NULL,
  "open_service_deals_count" integer DEFAULT 0 NOT NULL,
  "principal_deal_id" uuid,
  CONSTRAINT "chk_leads_email_ou_telefone" CHECK (((email IS NOT NULL) OR (telefone IS NOT NULL) OR (anonimizado_em IS NOT NULL))),
  CONSTRAINT "chk_leads_legal_basis" CHECK (((legal_basis)::text = ANY ((ARRAY['consentimento'::character varying, 'legitimo_interesse'::character varying, 'execucao_contrato'::character varying, 'obrigacao_legal'::character varying, 'outra'::character varying])::text[]))),
  CONSTRAINT "chk_leads_lifecycle_stage" CHECK (((lifecycle_stage)::text = ANY ((ARRAY['lead'::character varying, 'oportunidade'::character varying, 'cliente'::character varying])::text[]))),
  CONSTRAINT "chk_leads_origem_registro" CHECK (((origem_registro)::text = ANY ((ARRAY['formulario'::character varying, 'importacao'::character varying, 'whatsapp'::character varying, 'manual'::character varying, 'api'::character varying])::text[]))),
  CONSTRAINT "fk_leads_principal_deal" FOREIGN KEY (tenant_id, principal_deal_id) REFERENCES modulo_crm.crm_deal(tenant_id, id) ON DELETE SET NULL (principal_deal_id),
  CONSTRAINT "fk_leads_usuario_responsavel" FOREIGN KEY (usuario_responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT "leads_assigned_by_rule_id_fkey" FOREIGN KEY (assigned_by_rule_id) REFERENCES modulo_crm.crm_assignment_rule(id) ON DELETE SET NULL,
  CONSTRAINT "leads_mesclado_em_id_fkey" FOREIGN KEY (mesclado_em_id) REFERENCES modulo_crm.leads(id) ON DELETE CASCADE,
  CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID,
  CONSTRAINT "leads_custom_fields_not_null" NOT NULL custom_fields,
  CONSTRAINT "leads_id_not_null" NOT NULL id,
  CONSTRAINT "leads_lifecycle_stage_not_null" NOT NULL lifecycle_stage,
  CONSTRAINT "leads_nome_not_null" NOT NULL nome,
  CONSTRAINT "leads_open_deals_count_not_null" NOT NULL open_deals_count,
  CONSTRAINT "leads_open_service_deals_count_not_null" NOT NULL open_service_deals_count,
  CONSTRAINT "leads_tenant_id_not_null" NOT NULL tenant_id,
  CONSTRAINT "leads_won_deals_count_not_null" NOT NULL won_deals_count,
  CONSTRAINT "leads_pkey" PRIMARY KEY (id),
  CONSTRAINT "uq_leads_tenant_id" UNIQUE (tenant_id, id)
);
CREATE INDEX idx_leads_arquivados ON modulo_crm.leads USING btree (tenant_id, archived_at) WHERE ((archived_at IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_leads_custom_fields_gin ON modulo_crm.leads USING gin (custom_fields);
CREATE INDEX idx_leads_dedup_cnpj ON modulo_crm.leads USING btree (tenant_id, dedup_cnpj text_pattern_ops) WHERE (deleted_at IS NULL);
CREATE INDEX idx_leads_dedup_cpf ON modulo_crm.leads USING btree (tenant_id, dedup_cpf text_pattern_ops) WHERE (deleted_at IS NULL);
CREATE INDEX idx_leads_dedup_email ON modulo_crm.leads USING btree (tenant_id, dedup_email) WHERE (deleted_at IS NULL);
CREATE INDEX idx_leads_dedup_telefone ON modulo_crm.leads USING btree (tenant_id, dedup_telefone) WHERE (deleted_at IS NULL);
CREATE INDEX idx_leads_lifecycle ON modulo_crm.leads USING btree (tenant_id, lifecycle_stage) WHERE (deleted_at IS NULL);
CREATE INDEX idx_leads_lixeira ON modulo_crm.leads USING btree (tenant_id, deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_leads_telefone ON modulo_crm.leads USING btree (tenant_id, telefone);
CREATE INDEX idx_leads_tenant_id ON modulo_crm.leads USING btree (tenant_id);
CREATE INDEX leads_tenant_lead_score_idx ON modulo_crm.leads USING btree (tenant_id, lead_score);
ALTER TABLE modulo_crm."leads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modulo_crm."leads" FOR ALL USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON modulo_crm.leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION modulo_crm.bloquear_edicao_crm_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.entidade, NEW.entidade_id, NEW.payload, NEW.occurred_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.entidade, OLD.entidade_id, OLD.payload, OLD.occurred_at) THEN
    RAISE EXCEPTION 'crm_event é append-only: só o controle de processamento pode mudar';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION modulo_crm.bloquear_edicao_evento()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.lgpd_anonimizando', true) = 'on' THEN
    IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.created_at) THEN
      RAISE EXCEPTION 'crm_lead_event: a anonimização só pode mudar diff e detalhes';
    END IF;
    RETURN NEW;
  END IF;
  -- `autor_id` pode virar NULL: é o ON DELETE SET NULL de quando o usuário sai.
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.diff, NEW.detalhes, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.diff, OLD.detalhes, OLD.created_at)
     OR (NEW.autor_id IS NOT NULL AND NEW.autor_id IS DISTINCT FROM OLD.autor_id) THEN
    RAISE EXCEPTION 'crm_lead_event é append-only: só lead_id pode mudar (mesclagem)';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION modulo_crm.chave_documento(documento text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT NULLIF(upper(regexp_replace(documento, '[^0-9A-Za-z]', '', 'g')), '')
$function$;

CREATE OR REPLACE FUNCTION modulo_crm.chave_telefone(telefone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  WITH d AS (SELECT regexp_replace(telefone, '[^0-9]', '', 'g') AS v),
       sem_ddi AS (
         SELECT CASE WHEN length(v) IN (12, 13) AND left(v, 2) = '55' THEN substr(v, 3) ELSE v END AS v FROM d
       )
  SELECT NULLIF(
    CASE WHEN length(v) = 11 AND substr(v, 3, 1) = '9' THEN left(v, 2) || substr(v, 4) ELSE v END,
    ''
  ) FROM sem_ddi
$function$;
