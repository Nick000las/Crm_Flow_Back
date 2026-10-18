/**
 * Tipos do módulo CRM. Sem TypeScript, servem ao editor (via JSDoc) e como
 * documentação viva do contorno de dado que sai dos `adapters/`.
 *
 * Camada 1 (docs/crm/plano-campos-hibridos.md) — sempre ativa, `email`/
 * `telefone` são cada um opcional isoladamente (regra "pelo menos um dos
 * dois" é `chk_leads_email_ou_telefone` no banco + validação no service).
 *
 * @typedef {object} LeadCamada1
 * @property {string | null} email
 * @property {string | null} fonte_lead
 * @property {string | null} status
 * @property {string[] | null} tags
 * @property {string | null} ultima_interacao_em
 * @property {string | null} primeiro_nome derivado do nome e editável (M10)
 */

/**
 * Camada 2 — nativa, visibilidade controlada por tenant via
 * `crm_field` + `crm_field_visibility` (ver `field-schema.service.js`).
 *
 * @typedef {object} LeadCamada2
 * @property {string | null} empresa
 * @property {string | null} cargo
 * @property {string | null} cpf
 * @property {string | null} cnpj
 * @property {string | null} cidade
 * @property {string | null} uf
 * @property {string | null} cep
 * @property {string | null} endereco
 * @property {string | null} campanha_utm
 * @property {string | null} data_conversao
 * @property {number | null} probabilidade_fechamento
 * @property {string | null} data_prevista_fechamento
 * @property {string | null} motivo_perda
 * @property {number | null} lead_score
 * @property {string | null} proximo_followup
 */

/**
 * @typedef {LeadCamada1 & LeadCamada2 & object} Lead
 * @property {string} id
 * @property {string} nome
 * @property {string | null} telefone
 * @property {number | null} valor
 * @property {string | null} funil_estagio_id
 * @property {Record<string, unknown>} custom_fields
 * @property {string | null} usuario_responsavel_id
 * @property {string | null} [estagio_nome]
 */

/**
 * @typedef {object} CriarLeadInput
 * @property {string} nome
 * @property {string} [telefone]
 * @property {string | null} [funilEstagioId] opcional — estágios ficam em aberto até o Kanban
 * @property {number} [valor]
 * @property {string} [usuarioResponsavelId] omitido na rota → o service usa quem está criando
 * @property {Record<string, unknown>} [customFields]
 * @property {string} [email]
 * @property {string} [fonteLead]
 * @property {string} [status]
 * @property {string[]} [tags]
 * @property {Date} [ultimaInteracaoEm]
 * @property {string} [primeiroNome] omitido → derivado do nome (primeiro-nome.service.js)
 * @property {string} [empresa]
 * @property {string} [cargo]
 * @property {string} [cpf]
 * @property {string} [cnpj]
 * @property {string} [cidade]
 * @property {string} [uf]
 * @property {string} [cep]
 * @property {string} [endereco]
 * @property {string} [campanhaUtm]
 * @property {Date} [dataConversao]
 * @property {number} [probabilidadeFechamento]
 * @property {Date} [dataPrevistaFechamento]
 * @property {string} [motivoPerda]
 * @property {number} [leadScore]
 * @property {Date} [proximoFollowup]
 */

/**
 * Edição parcial: campo omitido (`undefined`) mantém o valor; `null` limpa
 * (exceto `nome`/`funilEstagioId`). Em `customFields`, chave com valor faz
 * merge raso e chave `null` é removida do JSONB. Ver
 * `leads.repository.js#atualizarLead`. Os campos marcados `| null` abaixo
 * valem pra todas as colunas de Camadas 1/2.
 *
 * @typedef {object} AtualizarLeadInput
 * @property {string} [nome]
 * @property {string} [telefone]
 * @property {string} [funilEstagioId]
 * @property {number | null} [valor]
 * @property {string | null} [usuarioResponsavelId]
 * @property {Record<string, unknown>} [customFields]
 * @property {string | null} [email]
 * @property {string} [fonteLead]
 * @property {string} [status]
 * @property {string[]} [tags]
 * @property {Date} [ultimaInteracaoEm]
 * @property {string | null} [primeiroNome] `null` → volta ao derivado do nome
 * @property {string} [empresa]
 * @property {string} [cargo]
 * @property {string} [cpf]
 * @property {string} [cnpj]
 * @property {string} [cidade]
 * @property {string} [uf]
 * @property {string} [cep]
 * @property {string} [endereco]
 * @property {string} [campanhaUtm]
 * @property {Date} [dataConversao]
 * @property {number} [probabilidadeFechamento]
 * @property {Date} [dataPrevistaFechamento]
 * @property {string} [motivoPerda]
 * @property {number} [leadScore]
 * @property {Date} [proximoFollowup]
 */

/**
 * @typedef {'texto' | 'texto_longo' | 'numero' | 'monetario' | 'data' | 'booleano' | 'selecao' | 'selecao_multipla' | 'telefone' | 'email' | 'url'} FieldDefinitionTipo
 */

/**
 * @typedef {object} FieldDefinition
 * @property {string} id
 * @property {string} chave
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 * @property {number} ordem
 * @property {string} created_at
 */

/**
 * @typedef {object} CriarFieldDefinitionInput
 * @property {string} chave
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 * @property {number} ordem
 */

/**
 * @typedef {object} AtualizarFieldDefinitionInput
 * @property {string} label
 * @property {FieldDefinitionTipo} tipo
 * @property {string[] | null} opcoes
 * @property {boolean} obrigatorio
 */

/**
 * Estado de visibilidade de uma coluna de Camada 2 (docs/crm/plano-campos-hibridos.md)
 * pra um tenant. `coluna` é sempre um valor de `CAMADA_2_COLUNAS`.
 *
 * @typedef {object} FieldVisibility
 * @property {string} coluna
 * @property {boolean} visivel
 * @property {number} ordem
 * @property {boolean} obrigatorio
 */

/**
 * View de filtro salva (`modulo_crm.crm_filter_views`, migration 0010).
 * `filtros` tem o mesmo formato do body de POST /crm/leads/search, sem paginação.
 *
 * @typedef {object} FilterView
 * @property {string} id
 * @property {string} nome
 * @property {Record<string, unknown>} filtros
 * @property {string} created_at
 */

/**
 * Status de um job de importação (`modulo_crm.import_jobs`, migration 0010),
 * sem o `payload`.
 *
 * @typedef {object} ImportJob
 * @property {string} id
 * @property {'pendente' | 'processando' | 'concluido' | 'falhou'} status
 * @property {'pular' | 'atualizar' | 'criar'} estrategia_duplicata
 * @property {number} total_linhas
 * @property {number} linhas_processadas
 * @property {number} linhas_criadas
 * @property {number} linhas_atualizadas
 * @property {number} linhas_ignoradas
 * @property {number} linhas_com_erro
 * @property {{ linha: number, motivo: string }[]} relatorio_erro
 * @property {string} created_at
 * @property {string | null} concluido_em
 */

export {};
