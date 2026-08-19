🏗️ MASTER DOCUMENT: Arquitetura de Software e Infraestrutura

Projeto: Plataforma SwaS B2B (Atendimento Omnichannel, CRM e IA)
Versão: 2.4 (Arquitetura de Alta Resiliência e Escala — Cobrança de Assinatura)
Abordagem: "Paranoia Arquitetural" (Zero Trust, Cloud-Native, API-First)

---

📦 BLOCO 1: Fundamentos do Produto e Regras de Negócio

## 1.1. Modelo SwaS: Base Universal + Módulos Verticais

A plataforma não deve parecer um sistema genérico alugado (SaaS) nem operar com uma lógica visível de "tiers" (Base/Premium/Enterprise). O posicionamento é de **software sob medida evoluindo continuamente**, sustentado por uma arquitetura de dois níveis:

**Núcleo Base:** Um conjunto de funcionalidades robustas que beneficiam ~80% dos negócios — CRM/Kanban de clientes, gestão de agenda, Kanban de projetos internos, atendimento omnichannel com IA. Todo cliente começa aqui, com fricção zero (subdomínio genérico, identidade visual via JSON dinâmico, valor percebido desde o Day 1).

**Módulos Verticais:** Pacotes de funcionalidade específicos de nicho (ex: Módulo Psicologia — prontuários e evolução de sessão; Módulo Agência de Marketing — calendário editorial, aprovação de arte, gestão de postagens), habilitados por tenant conforme o segmento e a negociação comercial. Tecnicamente, cada módulo é um **pacote com contrato fixo** — schema de dados próprio, rotas de API, componentes de UI injetados no shell principal, permissões RBAC associadas — não um projeto sob encomenda caso a caso. Isso preserva a percepção de exclusividade para o cliente ("construímos isso pensando em você") sem transformar cada venda em manutenção isolada para a equipe.

A comunicação externa nunca usa vocabulário de "tier". Internamente, a combinação (núcleo + módulos habilitados + volume de uso) segue sendo, estruturalmente, a mesma dimensão de billing de um modelo em tiers — só que granular por módulo em vez de pacote fechado, e com o vocabulário voltado para "evolução do seu software" em vez de "upgrade de plano".

### 1.1.1. Arquitetura de Dados dos Módulos

- **Tabelas relacionais dedicadas por módulo**, sem restrição de quantidade (o custo real de escala em Postgres é volume de dados e complexidade de query — não número de tabelas). A projeção é de 10-20 módulos ao longo do roadmap.
- **Schemas nativos do Postgres como namespace por módulo** (`CREATE SCHEMA modulo_psicologia;`), em vez de tabelas soltas em `public`. Isso dá organização visual imediata do "mapa de módulos" do produto, permissionamento granular futuro, e permite descontinuar um módulo com `DROP SCHEMA ... CASCADE` sem risco de deixar tabelas órfãs.
- **JSONB permanece restrito a dados maleáveis de UI e customização por tenant** (cores, botões, terminologia, temas do Camaleão), validado por schema Zod. Dados de negócio de cada módulo são sempre relacionais e fortemente tipados.
- **RLS obrigatório e automaticamente verificado.** Toda tabela de negócio (do núcleo ou de qualquer módulo) exige `tenant_id` com Row-Level Security habilitado. Dado o volume projetado de tabelas, essa garantia não pode depender de disciplina humana: um teste automatizado no CI varre o schema do banco e falha o build se encontrar tabela com `tenant_id` sem RLS/policy correspondente. Este teste é um bloqueador de merge, não um item de backlog.

### 1.1.2. Registro e Ativação de Módulos

```
module_catalog          (module_key, name, version, description)
tenant_modules           (tenant_id, module_key, enabled_at, config_jsonb)
tenant_module_features   (tenant_id, module_key, feature_key, enabled_at)
```

- `tenant_modules` controla se o tenant tem acesso ao módulo como um todo (frontend esconde o menu; **backend valida a mesma regra antes de aceitar qualquer requisição para rotas daquele módulo** — a decisão nunca é só de UI, consistente com o princípio de "Casca Estúpida" do Bloco 4).
- `tenant_module_features` controla **funcionalidades específicas dentro de um módulo já habilitado**, permitindo rollout individual de uma evolução pedida por um cliente sem impactar os demais tenants do mesmo módulo. Quando a evolução se mostra relevante para o nicho inteiro, ela é promovida a comportamento padrão do módulo.

### 1.1.3. Disciplina de Evolução de Módulo (Migrations Compartilhadas)

Como todos os tenants de um módulo compartilham a mesma tabela, qualquer evolução do módulo — mesmo motivada por um cliente específico — afeta a estrutura de dados de todos os tenants daquele módulo simultaneamente. Regras não-negociáveis:

- Toda alteração de schema em módulo já vendido é **aditiva**: `ADD COLUMN` sempre nullable ou com `DEFAULT`; nunca remoção de coluna ou `NOT NULL` sem default em tabela com dados de produção.
- Toda funcionalidade nova dentro de um módulo nasce atrás de uma `tenant_module_feature`, mesmo que inicialmente ativada para um único tenant.

### 1.1.4. Critério de Priorização (Evolução Compartilhada vs. Trabalho Customizado)

Nem toda solicitação de cliente vira evolução do módulo padrão. O critério de decisão:

- **Beneficia genuinamente outros tenants do mesmo nicho?** → Entra como evolução do módulo, atrás de feature flag, com potencial de promoção a padrão.
- **É uma necessidade específica daquele cliente, sem generalização clara?** → Tratado como trabalho customizado à parte (fora do módulo padrão, precificado separadamente), preservando a capacidade da equipe de dizer "sim" a pedidos pontuais sem acumular dívida de manutenção genérica.

Esse mecanismo é, também, o argumento comercial central do modelo: o cliente vê o software evoluindo mesmo depois de fechado o contrato — não como marketing, mas como consequência direta da arquitetura de módulos e feature flags.

## 1.1.5. Ciclo de Vida do Tenant (Onboarding e Offboarding)

**Provisionamento (área de administração da plataforma):** a equipe interna cria o tenant, o usuário administrador inicial (credenciais, e-mail de contato) e vincula os módulos contratados — criação de tenant, usuário e módulos executada como transação atômica no banco, evitando estado de "tenant parcialmente criado" em caso de falha no meio do processo. O acesso não é liberado neste momento.

**Onboarding assistido:** treinamento da base de conhecimento da IA (ingestão inicial para o RAG) e reunião de explicação de uso conduzida pela equipe. Identidade visual (tema) já configurada previamente pela equipe, conforme o contrato.

**Liberação de acesso:** o tenant recebe acesso com tema, módulos e IA já configurados — fricção zero desde o primeiro login. A partir daqui, o próprio tenant gerencia seus usuários e opera de forma autônoma, podendo reeditar sua identidade visual (Preview de Marca, Bloco 4.1).

**Offboarding (cancelamento):** ver política de retenção detalhada no Bloco 2.4. O cancelamento não encerra o acesso aos dados de forma abrupta — mantém um caminho de reativação fluido, sem reconfiguração, dentro da janela de retenção definida.

## 1.6. Módulos Nativos do Núcleo (Consolidação de Ferramentas)

Princípio de posicionamento: eliminar a necessidade de o cliente manter múltiplas assinaturas de ferramentas paralelas (gestão de projetos, agendamento, CRM avançado, e-mail, base de conhecimento), entregando cada uma dessas funções nativamente integrada ao núcleo — sem abrir mão da qualidade que cada categoria de ferramenta especializada oferece isoladamente.

### 1.6.1. Motor Universal de Kanban

Um único motor de Kanban, parametrizado por tipo de entidade (`board_type`: `crm_leads`, `projetos`, `postagens_agencia`, etc.), reaproveitado por todos os casos de uso de quadro do sistema — CRM de vendas (Bloco 4.2), Gestão de Projetos, e Kanban de módulos verticais (ex: calendário editorial de agência, Bloco 1.1.4) — em vez de implementações separadas por caso de uso. O que varia entre eles é o schema do cartão (lead tem valor/etapa de funil; tarefa de projeto tem responsável/prazo/subtarefas), acomodado pela mesma arquitetura de módulos (`config_jsonb`, Bloco 1.1.1). Toda a mecânica de estado — Optimistic UI, Noisy Rollback, resolução de conflito concorrente, alternativa de teclado (Bloco 4.2/4.3), salas de Socket.io — é herdada integralmente por qualquer novo tipo de quadro, sem reimplementação.

- **Gestão de Projetos:** aba própria sobre o motor universal, com atribuição de responsável por card (roles), e chat interno por card.
- **Chat Interno por Card:** reuso do padrão de tempo real já estabelecido (Bloco 3.3) — uma sala de Socket.io por `card_id` — persistido em uma tabela genérica `card_comments`, vinculada ao motor de Kanban, não a um módulo específico.
- **Mini-Automações por Quadro (roadmap):** regras simples do tipo "quando card entra na coluna X, executa ação Y" configuráveis via `config_jsonb` por tenant, seguindo o mesmo padrão já definido para automação n8n (Bloco 5.4) — extensão de configuração, não infraestrutura nova.

### 1.6.2. Agendamento com Link de Uso Único

Sistema de disponibilidade por vendedor e visão consolidada da empresa, reaproveitando o padrão de endpoint sob demanda já validado (`GET /agenda/:id_user/disponibilidade?data=YYYY-MM-DD`, buscando apenas os horários ocupados por dia).

- **Link de agendamento é gerado sob demanda pelo vendedor**, vinculado a uma proposta de horário(s) específica — não é uma página pública persistente. O vendedor decide a quem envia; a responsabilidade de distribuição do link é do cliente/vendedor, não da plataforma.
- **Token assinado, de uso único e com expiração** (ex: 7 dias). Após a confirmação de um horário pelo destinatário, o link se invalida automaticamente; uma segunda tentativa de acesso ao mesmo token não retorna dado algum. Rate limiting básico aplicado à rota de confirmação, para impedir tentativas de enumeração de token.

### 1.6.3. Visão 360° do Cliente (Resumo Pré-computado)

Ao abrir uma conversa, o vendedor visualiza um resumo consolidado do histórico do cliente (negociações, interações anteriores, dado relevante de módulo vertical), eliminando a necessidade de consultar múltiplas fontes manualmente.

- **Resumo armazenado como cache derivado em JSONB** (`customer_summary`), não como fonte de verdade — todo o dado de origem (CRM, histórico de conversa, registros de módulo) permanece relacional, como já definido no Bloco 2.3. O uso de JSONB aqui é consistente com a regra já estabelecida (JSONB para dado maleável e não-relacional), estendida a caches derivados e recomputáveis: o resumo deve ser regenerável a qualquer momento a partir das tabelas fonte, nunca a única cópia existente do dado.
- **Atualização incremental por evento** (nova mensagem, negociação fechada, dado novo de módulo vertical) — nunca recalculado do zero a cada abertura de conversa, evitando pressão desnecessária sobre o gateway de acesso multi-tenant (Bloco 2.1).
- **Componente gerado por IA (opcional):** um resumo textual da relação com o cliente pode ser gerado via RAG sobre o histórico de conversa, reaproveitando a mesma infraestrutura vetorial já existente (Bloco 2.3) — recalculado apenas quando há mudança relevante, seguindo a mesma filosofia de cache consciente já aplicada ao Semantic Caching (Bloco 3.2) e à governança de custo de LLM (Bloco 6.4).

### 1.6.4. Assinatura Eletrônica de Documentos

Upload de documento, campo de assinatura e trilha de auditoria — reaproveitando a Imutabilidade Analítica já definida (Bloco 8.5) — eliminando a necessidade de o vendedor sair da plataforma para formalizar um contrato fechado pelo CRM.

### 1.6.5. Caixa de Entrada de E-mail Unificada

E-mail integrado ao mesmo painel omnichannel do vendedor (WhatsApp, Instagram), com acesso à mesma Visão 360° do Cliente (1.6.3) — fechando o conceito de atendimento omnichannel de fato, e reduzindo a dependência de cliente de e-mail externo (Gmail/Outlook) aberto em paralelo.

### 1.6.6. Base de Conhecimento Interna (Wiki)

Documentação interna do cliente (procedimentos, SOPs) armazenada com busca semântica sobre a mesma infraestrutura vetorial (pgvector, Bloco 2.3) já usada pelo RAG de atendimento — infraestrutura de duplo propósito, com custo incremental baixo. Opcionalmente, a base de conhecimento interna pode alimentar o próprio RAG do atendimento ao consumidor final, quando o tenant configurar essa integração.

## 1.7. Assessor Especializado (IA Consultiva Interna)

Assistente de IA voltado ao administrador do tenant — não ao consumidor final — oferecendo apoio à tomada de decisão, insights e sugestões baseadas em boas práticas de mercado, com um assistente geral de operação e assistentes dedicados por módulo (ex: assistente de vendas, assistente de operação), reaproveitando a mesma infraestrutura já definida para o atendimento ao consumidor:

- **Base de Conhecimento Global, Separada por Escopo:** o conteúdo consultivo (boas práticas, conceitos de mercado, material de referência) é armazenado como uma coleção vetorial global, sem `tenant_id` — distinta da base de RAG específica de cada tenant (Bloco 2.3), que serve o atendimento ao consumidor final. Ambas reaproveitam a mesma infraestrutura de pgvector, sem exigir nova peça de infraestrutura.
- **Curadoria de Conteúdo e Propriedade Intelectual:** a base de conhecimento é composta exclusivamente por conteúdo de domínio público, material produzido/sintetizado internamente (resumos e sínteses originais de conceitos, não cópia de texto de terceiros), ou conteúdo sob licença comercial explícita para este uso. Material de terceiros protegido por direito autoral (livros, palestras comerciais) não é ingerido sem licenciamento, para não expor a plataforma a risco de violação de propriedade intelectual nem reproduzir conteúdo protegido nas respostas ao administrador.
- **Acesso Somente-Leitura a Métricas:** o Assessor consulta dado do tenant exclusivamente via Tools de leitura sobre métricas agregadas do Dashboard de ROI (Bloco 1.4) — economia de horas, tempo de resposta, benchmark comparativo entre tenants — nunca dado individual identificável de consumidor final, e nunca Tools de ação (diferente do assistente de atendimento, Bloco 6.2, que executa ações reais). A ausência de capacidade de ação elimina a superfície de risco associada a Function Calling crítico.
- **Assistente por Módulo:** cada módulo vertical (Bloco 1.1) pode ter um assistente dedicado — system prompt específico, subconjunto da base de conhecimento e Tools de leitura relevantes ao módulo (ex: assistente de vendas consulta benchmark de conversão; assistente de operação consulta fila e SLA) — roteado pelo mesmo Provider Gateway multi-modelo já definido (Bloco 6.3), reaproveitando o `task_model_mapping` existente em vez de uma arquitetura de roteamento nova.
- **Governança de Custo Separada:** o consumo de tokens do Assessor é contabilizado de forma independente da Wallet de atendimento ao consumidor final (Bloco 1.3) — é uma ferramenta interna do tenant, não vinculada ao consumo de mensageria Meta. Se será incluída no licenciamento base ou cobrada como add-on é decisão de produto a definir antes do lançamento desta peça, não uma questão técnica em aberto.

## 1.2. Contenção de Custos (Meta) e Gestão de HSM

A API da Meta cobra por interações fora da janela de 24h. O sistema protege o caixa do cliente com bloqueios sistêmicos:

- **Bloqueio de Automação (Hard Limit):** A IA e o sistema são incapazes de enviar texto livre após 24h.
- **Módulo de Templates (HSM):** Após 24h, a caixa de texto livre do vendedor desaparece, sendo substituída por um menu de seleção de Templates aprovados pela Meta.
- **Retomada Dinâmica:** Ao disparar o template (comprado via saldo pré-pago) e obter resposta do consumidor, a janela se reabre, o campo de texto livre é liberado e a IA é religada automaticamente.
- **Iniciação de conversa fora da janela é decisão humana, não automática.** A automação/IA não inicia proativamente uma conversa fria via template — essa ação é do vendedor/usuário pela plataforma, exceto em campanhas de marketing configuradas explicitamente pelo tenant, que são o único caso onde a automação pode disparar templates em massa.

### 1.2.1. Reputação do Número (Quality Rating / Messaging Tier)

Camada independente da janela de 24h: cada número WhatsApp Business tem uma Quality Rating (Alta/Média/Baixa), calculada pela Meta com base em bloqueios e denúncias recentes, que determina um Messaging Tier — o limite diário de conversas iniciadas pela empresa. Rating em queda persistente rebaixa o tier ou bloqueia o número.

- O sistema consulta o Quality Rating do número periodicamente (job diário) e mantém **histórico em série temporal** (`tenant_id`, `phone_number_id`, `rating`, `messaging_tier`, `captured_at`) — não apenas o valor atual, permitindo visualizar tendência.
- Exibido no Dashboard do Bloco 1.4, com alerta automático em caso de queda, para o cliente agir antes de ser rebaixado de tier — especialmente relevante quando o cliente roda campanhas de marketing via WhatsApp.

## 1.3. Motor Financeiro (Billing) e Modelo BYOK

Para evitar que a empresa seja penalizada pela inadimplência ou pelo consumo variável dos clientes (tokens de IA e envios Meta):

### 1.3.1. Cobrança de Assinatura (Mensalidade)

Fluxo de pagamento distinto do consumo de Wallet (1.3.2) — trata da cobrança recorrente do licenciamento da plataforma (Núcleo + Módulos, Bloco 1.1), não do consumo variável de Meta/IA.

- **Pix Automático como trilho principal de cobrança recorrente**, com cartão de crédito recorrente como alternativa/fallback e boleto como opção manual residual (sem papel na automação de status, dada a ausência de confirmação em tempo real). Pix Automático oferece custo por transação substancialmente menor que MDR de cartão (frações de 1% contra 2-3,5%) e elimina a inadimplência involuntária típica de cartão (vencimento, limite, recusa de autorização) — adequado ao perfil de cobrança previsível de uma assinatura SaaS.
- **Processamento via gateway de pagamento terceirizado** com suporte nativo a Pix Automático, cartão e boleto em uma única API (ex: Pagar.me, Asaas, Mercado Pago) — não há integração direta com o Banco Central. O dado bancário/de cartão permanece custodiado pelo gateway; a plataforma armazena apenas identificadores de autorização, minimizando escopo de conformidade (PCI, dados bancários sensíveis).
- **Status do tenant como máquina de estados**, não um campo booleano — necessário para que ações automatizadas (liberação, período de graça, suspensão) respondam corretamente à posição real do tenant no ciclo de cobrança:
  - `trial` — período de avaliação, acesso liberado.
  - `active` — assinatura em dia, acesso liberado.
  - `past_due` — cobrança falhou; acesso **ainda liberado** durante período de graça configurável (ex: 3-5 dias), com régua de cobrança automática acionada.
  - `suspenso` — período de graça esgotado sem regularização; acesso bloqueado, dados preservados conforme a política de retenção já definida (Bloco 2.4).
  - `cancelado` — segue o fluxo de Offboarding já formalizado (Bloco 1.1.5/2.4).
- **Webhook do gateway com validação de assinatura obrigatória**, seguindo o mesmo princípio já aplicado ao webhook da Meta — o payload é assinado pelo gateway e validado pelo backend antes de qualquer mudança de estado ser aceita como legítima.
- **Idempotência no processamento de webhook:** eventos de pagamento podem ser reentregues pelo gateway (falha de rede, timeout). O ID do evento processado é registrado e eventos já vistos são ignorados, prevenindo duplicação de transições de estado (reativação dupla, suspensão fora de ordem).
- **Régua de Cobrança Automatizada (Dunning):** ao entrar em `past_due`, uma sequência de lembretes é agendada via BullMQ (ex: dias 1, 3 e 5 do período de graça), reaproveitando o mesmo padrão de job atrasado e cancelável já definido para notificação proativa de incidentes (Bloco 7.2) — cancelada automaticamente se o pagamento for confirmado antes do disparo.

### 1.3.2. Wallet de Consumo (Meta/IA) e Modelo BYOK

- **Carteiras Pré-pagas (Wallets):** O consumo é debitado de um saldo pré-adquirido com markup embutido. Alertas em limites críticos (ex: 10%) e Hard Stop automático a 0%, com Auto-Recarga opcional no cartão de crédito.
- **Débito atômico obrigatório:** toda operação de débito de wallet é feita via `UPDATE` atômico no Postgres (`SET balance = balance - X WHERE balance >= X`), nunca via leitura-e-escrita na aplicação — elimina condição de corrida entre workers/instâncias concorrentes debitando o mesmo saldo.
- **Reconciliação Real vs. Estimado:** job periódico que compara o ledger interno de débitos com o relatório de billing real da Meta/provedores de IA, disparando alerta interno se a divergência ultrapassar um threshold (ex: 2-3%).
- **Bring Your Own Key (BYOK):** Para contas que fornecem as próprias chaves (Meta, OpenAI, Groq), a empresa fatura exclusivamente sobre licenciamento de software elevado, sem risco de infraestrutura de IA.
- **Cláusula de Uso Razoável para BYOK:** mesmo sem cobrança por token/mensagem, o volume processado pela plataforma (fila, workers, socket, storage) tem custo de infraestrutura próprio. O consumo de *plataforma* é registrado separadamente do consumo de *IA/Meta* desde o desenho do schema (mesmo para tenants BYOK, que não são debitados na segunda métrica), com um volume de referência por contrato e fee de infraestrutura sobre excedente.

## 1.4. SLA, Presença e Dashboard de Retenção

O escalonamento e o atendimento devem proteger a relação com o consumidor e o valor percebido do software:

- **Roteamento Baseado em Presença:** vendedores declaram estado (Online/Pausa).
- **Transbordo Manual com Alerta:** se o SLA de 15 minutos for rompido, o lead não roda em Round-Robin cego (o que quebra o contexto da venda); um alerta visual é disparado para a Gerência realizar a transferência consciente (Hand-off).
- **Congelamento de SLA:** status como "Verificação Interna" pausam o cronômetro para não prejudicar métricas do vendedor.
- **Dashboard de ROI:** a tela inicial do administrador foca em valor financeiro (ex: "A IA economizou 40h de equipe este mês. ROI estimado: R$ 1.500"), provando o valor da plataforma diariamente.
- **Reputação do Número (Quality Rating):** integrado a este dashboard, com tendência histórica e alertas — ver 1.2.1.
- **Benchmark Comparativo de Mercado:** métricas do tenant (ex: tempo médio de primeira resposta) exibidas lado a lado com a média agregada e anonimizada entre todos os tenants da plataforma (ex: "sua equipe responde em 40s. A média da plataforma é 5 minutos"). O cálculo é sempre agregado (`AVG()` sobre o conjunto), nunca expondo desempenho individual de outro tenant identificável.
- **Economia de Janela de 24h:** contador de reaberturas de janela evitadas no mês graças a resposta humana dentro do prazo — traduz a limitação técnica de custo de template (Bloco 1.2) em métrica positiva de eficiência da equipe do cliente.

---

📦 BLOCO 2: Arquitetura de Banco de Dados e Isolamento (Multi-tenant)

## 2.1. Isolamento Lógico Absoluto (Hard RLS)

Utilizaremos o PostgreSQL (Neon DB). O vazamento de dados entre clientes é prevenido na fundação:

- **Regra do Tenant:** Todas as tabelas de negócio — do núcleo e de qualquer módulo vertical (ver Bloco 1.1.1) — exigem a coluna `tenant_id`, com Row-Level Security habilitado e policy correspondente. Sem exceção.

- **Camada de Acesso Dedicada (Tenant-Scoped Query Gateway):** o Backend (Fastify) não expõe o Prisma Client diretamente para código de negócio que toca dado de tenant. Em vez disso, toda query multi-tenant passa por um wrapper dedicado, construído sobre um client raw (`postgres.js` ou `pg`), que garante determinística e explicitamente:
  ```
  BEGIN
  SET LOCAL app.current_tenant = '<tenant_id>'
  <query de negócio>
  COMMIT
  ```
  executado na mesma conexão física, do início ao fim. Essa garantia é o que impede requisições assíncronas concorrentes de misturarem contexto de tenant em instâncias de banco com alta concorrência.

  *Por que não usar `prisma.$transaction` interativo diretamente:* cada transação interativa do Prisma reserva uma conexão dedicada do pool pela duração inteira da request. Sob volume real de usuários simultâneos, isso esgota o pool rapidamente — um problema que não aparece em desenvolvimento e só se manifesta sob carga de produção. O Prisma Client continua sendo usado normalmente para operações administrativas internas, migrations e qualquer dado sem `tenant_id`; apenas o caminho de dado multi-tenant passa pelo gateway dedicado.

  **Decisão de MVP:** para o time atual (dois desenvolvedores, prazo curto), o MVP inicia com `prisma.$transaction` interativo para o caminho multi-tenant — mais simples de implementar e suficiente para o volume inicial de usuários. O gateway dedicado é debt técnico documentado, não esquecido, com gatilho de migração explícito e mensurável: monitoramento de utilização do pool de conexões (exposto nativamente pelo Neon), migrando para o gateway dedicado quando a utilização ultrapassar 70-80% em uso normal (fora de pico) — antes que vire incidente em produção. Desde o MVP, o `connection_limit` do Prisma e o tamanho do pool do Neon são dimensionados com folga consciente (não o default), com alerta caso a aplicação comece a enfileirar/esperar por conexão — o primeiro sinal de alerta, anterior ao próprio threshold de migração.

- **Teste de Isolamento Automatizado (CI Gate):** um teste de integração roda a cada Pull Request tentando *ativamente* vazar dados entre dois tenants de teste (não apenas validar que "funciona", mas provar que não é possível burlar). Um segundo teste varre o schema do banco inteiro e falha o build se encontrar qualquer tabela com coluna `tenant_id` sem RLS habilitado e sem policy correspondente. Ambos são bloqueadores de merge — a segurança de isolamento não depende de disciplina humana de lembrar de aplicar RLS em cada tabela nova, especialmente considerando o volume de tabelas projetado pelos Módulos Verticais (Bloco 1.1.1).

## 2.2. Gestão de Segredos e Versionamento Criptográfico

As chaves de API e Tokens de clientes são armazenadas usando criptografia AES-256.

- **Custódia da Chave Mestra:** a chave mestra de criptografia não reside em variável de ambiente da aplicação ou da VPS — isso constitui um single point of failure catastrófico, já que qualquer acesso ao container/VPS resultaria em descriptografia total da base. A chave mestra é custodiada em um serviço de gestão de chaves dedicado (KMS — AWS KMS, GCP KMS, ou HashiCorp Vault), separando fisicamente a chave do ambiente de execução da aplicação. Este requisito é elevado a bloqueador para qualquer negociação com clientes Enterprise regulados (bancos, planos de saúde), que tipicamente auditam esse ponto especificamente.

- **Lazy Key Rotation:** evita-se scripts de migração massivos (que causam corrupção em caso de queda). O sistema utiliza a coluna `key_version`. Quando um token é lido com uma chave mestra antiga, o backend o recriptografa silenciosamente com a chave nova e atualiza o banco em tempo real (Zero Downtime).

## 2.3. Segregação de IA e Governança de Dados

- **Read Replicas para RAG:** a busca semântica (pgvector) exige processamento pesado. O sistema roteia webhooks de conversas para a base de Escrita (Writer) e consultas da IA para a base de Leitura (Read Replica), impedindo que a inteligência artificial sufoque a velocidade do CRM.

  **Tratamento de Replica Lag:** a replicação Writer → Replica é assíncrona. Para o caso comum de a IA precisar do contexto da própria mensagem recém-chegada como parte do prompt, esse contexto imediato é montado a partir do payload em memória/fila (não depende de leitura da réplica). Consultas de RAG que dependem de histórico consolidado (não da mensagem mais recente) seguem pela Read Replica normalmente, com monitoramento de lag e fallback para o Writer caso o lag ultrapasse um threshold definido.

  **Manutenção de Índice Vetorial:** índices HNSW/IVFFlat do pgvector degradam em qualidade de busca conforme o volume de embeddings cresce, exigindo rebuild periódico. Um job de manutenção agendado (fora de horário de pico) monitora e reconstrói os índices vetoriais — tratado como rotina operacional documentada, não como debt esquecido.

- **Arquitetura de Dados por Camada:**
  - **JSONB** é restrito a dados maleáveis de UI e customização por tenant (cores, temas do Camaleão), validado por schemas Zod.
  - **Dados de negócio do núcleo** (billing, limites, faturamento) são colunas relacionais fortemente tipadas (integers/booleans) para performance analítica.
  - **Dados de negócio de Módulos Verticais** seguem o padrão de schemas nomeados por módulo definido no Bloco 1.1.1 (ex: `modulo_psicologia.prontuarios`), mantendo a mesma disciplina de tipagem forte e RLS por tabela.

- **Particionamento e Offboarding:** mensagens antigas (Cold Data) são particionadas para o S3. Cancelamentos geram exclusões lógicas (Soft Delete), e a limpeza física é feita por workers assíncronos na madrugada para não travar tabelas (Table Lock).

- **Portabilidade de Dados (LGPD, Art. 18):** além da capacidade de anonimização (Bloco 8), o titular de dados tem direito a solicitar seus dados em formato estruturado. Dado que o modelo de dados é normalizado por `tenant_id` desde a fundação, isso é exposto como um endpoint administrativo de exportação — baixo custo de implementação dado o desenho de schema já adotado, e um argumento concreto de conformidade em negociações Enterprise.
  - **Export de CRM em Excel/CSV:** implementação da portabilidade em formato diretamente usável pelo tenant (não apenas JSON bruto), acessível a qualquer momento pelo próprio admin — reforça transparência e reduz a percepção de aprisionamento de dados ("vendor lock-in"), argumento de confiança tanto na venda quanto na retenção.
  - **Export de Conversa Individual:** o vendedor pode exportar o histórico de uma conversa específica (formato tipo transcript, com balões e timestamp) sob demanda — atende pedidos pontuais do consumidor final sem exigir o processo formal de portabilidade completa.

## 2.4. Retenção e Ciclo de Vida de Dados de Conversa

- **Conteúdo de conversa (WhatsApp/Instagram) é retido por tempo limitado, mesmo com o tenant ativo.** A IA e o histórico de atendimento exigem acesso ao conteúdo integral da conversa (mensagem do consumidor e resposta do vendedor) para funcionar — não há como reter apenas um dos lados sem quebrar contexto, e a resposta do vendedor tipicamente reconstitui o mesmo dado sensível da pergunta original. A retenção de dado pessoal identificável não é indefinida por padrão: conversas mais antigas que um período definido (ex: 12-24 meses, mesmo em tenant ativo) são anonimizadas automaticamente — identificadores pessoais removidos via extração de PII (nome, telefone, CPF, e-mail), preservando o conteúdo agregado para BI e relatórios sem vínculo a uma pessoa identificável.

- **Offboarding (cancelamento de tenant):** dados de conversa (WhatsApp/Instagram) são retidos por um período curto (ex: 1-2 meses) após o cancelamento e então anonimizados. Configuração da plataforma — usuários, base de conhecimento da IA, registros de CRM — permanece retida por um período mais longo (ex: até 6 meses), sustentando um caminho de reativação fluido, sem necessidade de reconfiguração, funcionando como incentivo comercial de retorno. Ambos os prazos são parametrizáveis, com teto definido — nunca retenção indefinida por padrão.

- **Dataset Harvesting como Opt-in (ver Bloco 8.6):** o uso de conteúdo de conversa para treino de modelo é regido por consentimento explícito do tenant e anonimização prévia — tratado em detalhe no Bloco 8.6, dada sua relevância para postura de conformidade em auditoria.

---

📦 BLOCO 3: Backend, Filas e Tempo Real

## 3.1. Ingestão de Webhooks e Desacoplamento

**Garantia de Entrega (200 OK):** o Fastify atua como um funil absoluto. Recebe a carga da Meta, insere na fila do Redis (BullMQ) e devolve o 200 OK na mesma requisição, impedindo que lentidões na IA causem bloqueios por parte do WhatsApp.

## 3.2. Orquestração, Resiliência e Concorrência (BullMQ)

- **FIFO por Entidade:** para evitar que o sistema grave o recebimento de uma mensagem fora de ordem, os workers processam tarefas de forma sequencial com base no `lead_id`.

- **Fila Justa entre Tenants (Fair Queueing):** a fila de processamento é única, mas cada tenant possui um teto de concorrência simultânea — um limite de quantos jobs daquele tenant podem estar em processamento ao mesmo tempo pelos workers (ex: máximo de 5 simultâneos), controlado por um contador atômico no Redis (`INCR`/`DECR` com TTL de segurança), checado antes de um worker assumir o próximo job daquele tenant. Isso garante que nenhum tenant — independente do volume que gerar — consiga monopolizar a capacidade de processamento e degradar o atendimento dos demais. É requisito de dia 1, não debt: estruturalmente simples de implementar sobre a fila existente, e funciona como diferencial comercial direto ("seu atendimento nunca fica lento por causa do volume de outro cliente na plataforma").

- **Retry Pattern & DLQ:** chamadas à LLM falhas tentam novamente (Exponential Backoff). Falhas crônicas ou payloads corrompidos são isolados em uma Dead Letter Queue (DLQ) para não envenenarem a fila de atendimento principal.

- **Semantic Caching com Granularidade Temporal e Controle do Admin:** respostas idênticas de IA (ex: horário de funcionamento, promoções) geram um hash no Redis, cuja chave incorpora a data corrente (ex: hash da pergunta + `YYYY-MM-DD`). Isso invalida o cache automaticamente a cada dia, sem lógica adicional, cobrindo o caso de informação com validade temporal curta (promoção do dia). Complementarmente, o painel do admin expõe uma ação de negócio — "Atualizar respostas do bot" — que executa o purge das chaves de cache daquele tenant sob demanda, com exibição do timestamp da última atualização. A ação é apresentada em linguagem de negócio, não como operação técnica de cache.

## 3.3. Tempo Real de Alta Disponibilidade (Socket.io)

- **Redis Adapter desde o Dia 1:** o Socket.io é configurado com `@socket.io/redis-adapter` mesmo operando em uma única instância de backend no MVP. Sem essa configuração, eventos emitidos em uma instância não chegam a clientes conectados em outra — uma falha que não se manifesta em ambiente de instância única e aparece de forma silenciosa (sem erro explícito, apenas mensagens que não chegam) exatamente no momento de escalar horizontalmente. Configurar desde o início elimina esse risco sem custo perceptível na operação atual.

- **Salas Estritas:** administradores conectam-se à Room do `tenant_id`; vendedores conectam-se à Room do `user_id`, garantindo isolamento de contexto no painel do Kanban.

- **State Recovery:** se a conexão Socket oscilar no navegador, o Next.js é instruído a realizar um HTTP GET de recuperação (Full Fetch) no exato momento da reconexão, anulando o risco de mensagens fantasmas. A UI exibe um indicador visual sutil de estado de conexão ("Reconectando..." / "Conectado") durante a oscilação, evitando a percepção de instabilidade silenciosa para o vendedor.

## 3.4. Transparência Operacional (Valor Percebido)

- **Painel de Fila em Tempo Real:** o Dashboard de ROI (Bloco 1.4) expõe métricas de fila por tenant — mensagens em atendimento pela IA no momento, tempo médio de resposta — reforçando visualmente a promessa de SLA da plataforma com dados que já existem internamente pela arquitetura de fila justa.

- **Painel de Atenção Necessária (DLQ traduzida):** a Dead Letter Queue, tecnicamente interna, é exposta ao admin em linguagem de negócio ("N mensagens precisam de revisão manual") com ação de reprocessar, transformando uma falha técnica silenciosa em um ponto de controle visível para o cliente.

## 3.5. Persistência e Durabilidade do Redis

Requisito de infraestrutura não-negociável desde o dia 1: o Redis que sustenta as filas do BullMQ opera com AOF (Append Only File) habilitado, fsync a cada segundo (`everysec`) — equilíbrio adequado entre durabilidade e performance. Sem essa configuração, um crash da VPS resulta em perda total dos jobs em fila e em processamento, incluindo mensagens de clientes ativas no momento da falha.

## 3.6. Versionamento de API

Aplica-se exclusivamente à superfície pública da API — rotas consumidas por integrações de terceiros ou clientes Enterprise de forma independente do deploy da própria plataforma (ex: API de leads, webhooks expostos ao cliente). Rotas consumidas apenas pelo frontend próprio, deployado em sincronia com o backend, não exigem esse controle.

- **Versionamento via prefixo de URL** (`/api/v1/...`). Mudanças que quebram contrato (remoção de campo, alteração de tipo ou comportamento) nascem em uma nova versão (`/api/v2/...`), rodando em paralelo à anterior — nenhuma integração existente quebra sem aviso.
- **Política de descontinuação:** versões antigas são aposentadas com prazo mínimo de aviso (ex: 90 dias), comunicado antecipadamente aos clientes integrados.

---

📦 BLOCO 4: Frontend Camaleão (UI/UX)

## 4.1. Edge Middleware, Tema e Performance

O Next.js Middleware (Edge Runtime) intercepta a requisição antes de qualquer renderização, identifica o tenant pelo subdomínio ou domínio customizado, e injeta o tema (cores, logo, terminologia) diretamente no HTML via variáveis CSS (Custom Properties) — antes do primeiro byte ser enviado ao navegador.

- **Cache de tema em Upstash Redis (REST), com escopo restrito.** O runtime de Edge não suporta conexão TCP tradicional (o Redis principal, usado por filas e sockets na VPS, não é acessível a partir do Edge). Um serviço Upstash Redis — compatível com Edge via API REST/HTTP — é utilizado exclusivamente para o cache de tema por tenant. Não substitui nem duplica o Redis operacional da VPS; é uma peça de infraestrutura isolada, de responsabilidade única, com volume de leitura/escrita baixo o suficiente para operar dentro do plano gratuito no estágio atual.

- **Prevenção de Flash de Marca (Anti-FOUC):** o tema é resolvido e injetado no Server Component raiz do layout, nunca aplicado posteriormente via JavaScript no cliente — não existe janela de tempo em que um tema default é renderizado e depois substituído. Fluxo:
  1. Middleware identifica o tenant pela URL.
  2. Consulta o tema via Upstash (REST).
  3. Injeta as variáveis CSS no `<head>` antes da resposta ser enviada.
  4. Em caso de cache-miss (tenant novo ou cache expirado), aplica-se o tema default do sistema sem bloquear a requisição, disparando de forma assíncrona um refresh do cache a partir da fonte de verdade (Postgres) para as próximas requisições.
  5. **Write-through obrigatório:** ao salvar uma alteração de identidade visual, o backend grava simultaneamente no Postgres (fonte de verdade) e no Upstash (cache), eliminando o delay entre a alteração e sua propagação.

- **Preview de Marca:** antes de confirmar uma alteração de identidade visual, o admin visualiza o mesmo shell de produção (Kanban/painel de exemplo) renderizado com o estado local do formulário (ainda não persistido), atualizando em tempo real conforme os ajustes. Reaproveita os componentes de produção existentes — não é uma tela nova a manter, apenas uma fonte de dado diferente (estado local vs. tema persistido) — e evita que o cliente valide mudanças de marca diretamente em produção.

## 4.2. Estado do Kanban

- **Optimistic UI:** o ato de arrastar um card pelo funil reflete visualmente de imediato.

- **Noisy Rollback:** caso o worker assíncrono falhe ao salvar a etapa, a interface força o card de volta à origem de maneira visível e dispara um alerta vermelho (Toast), impossibilitando falhas silenciosas que frustram vendedores.

- **Resolução de Conflito Concorrente:** edição concorrente do mesmo card por dois administradores segue política de last-write-wins por timestamp. Quando o backend detecta que o card foi modificado por outro usuário nos segundos anteriores, o socket emite um toast informativo ao segundo editor (ex: "Card também movido por Maria agora há pouco") — sem bloquear ou reverter a ação, apenas tornando a concorrência visível, consistente com a filosofia de nunca falhar silenciosamente já adotada no Noisy Rollback.

- **Casca Estúpida (Dumb UI):** a interface obedece estritamente às diretrizes da API. Regras de limitação de caracteres, exibição de menus ou bloqueios de janelas de 24h são decididas no servidor, não no navegador do cliente.

## 4.3. Acessibilidade (WCAG AA) como Padrão Verificável

Acessibilidade é tratada como requisito de engenharia com mecanismo de verificação, não como diretriz informal — para não ser a primeira prática descartada sob pressão de prazo:

- **Base de componentes acessível por padrão:** a biblioteca de UI (shadcn/ui, construída sobre Radix UI) já implementa corretamente foco de teclado, ARIA roles e navegação nos componentes primitivos (dropdown, dialog, tabs, etc.). Componentes customizados que contornam essa base sem necessidade não são permitidos.

- **Gate automatizado no CI:** `eslint-plugin-jsx-a11y` identifica erros estruturais (imagem sem `alt`, botão sem label acessível) no code review; testes automatizados com `axe-core` rodam contra as páginas principais, verificando contraste de cor e estrutura semântica. Regressões de acessibilidade bloqueiam merge, no mesmo padrão já adotado para RLS (Bloco 2.1).

- **Alternativa por teclado ao Kanban (drag-and-drop):** o Kanban, por depender de arrastar-e-soltar, não é acessível por natureza a usuários de teclado ou leitor de tela. Cada card oferece uma ação equivalente por teclado — um menu ("Mover para: [etapa]") que executa exatamente a mesma transição de estágio do lead. Tratado como parte funcional do componente desde a primeira versão, não como adição posterior, dado o custo de retrofitar a tela mais utilizada do sistema.

---

📦 BLOCO 5: Motor de Automação Externo (n8n)

O n8n opera self-hosted como o "braço braçal" do SwaS, focado em automações leves de orquestração externa (RPA simples, notificações internas, integrações pontuais com sistemas de terceiros) — sem poluir o repositório principal e sem carregar lógica de negócio crítica do produto.

## 5.1. Papel Estratégico e Escopo Deliberadamente Limitado

O n8n é adotado, neste momento, como **alavanca comercial para os primeiros clientes** — aumenta o poder de barganha em negociação e o valor percebido do setup, viabilizando reinvestimento do faturamento inicial em aquisição de mais clientes. Não é tratado como infraestrutura crítica de longo prazo: a oferta é avaliada continuamente com os primeiros clientes, podendo ser descontinuada caso se prove pouco demandada, ou mantida e reforçada em infraestrutura caso se mostre valiosa na escala de dezenas de clientes.

Nesse escopo, o n8n é reservado para automações pontuais e específicas por sistema de terceiro (notificar um ERP externo ao mudar etapa de um lead, disparar mensagem interna em outro sistema do cliente, etc.) — não para funcionalidades centrais do produto, que residem em código no backend principal, com o tratamento robusto de credenciais e orquestração já definido nos Blocos 1 a 4.

## 5.2. Ponto Único de Falha (SPOF) — Risco Aceito e Documentado

Rodando como instância única em Docker, uma queda do n8n interrompe as automações que dependem dele — incluindo o próprio Reverse Callback que normalmente alertaria sobre falhas de integração. Dado o escopo limitado a automações não-críticas (5.1), esse risco é conscientemente aceito nesta fase, sem investimento em *queue mode* (Redis + múltiplos workers) ou alta disponibilidade. Caso o n8n se prove uma oferta permanente e cresça em criticidade, essa decisão de infraestrutura é revisitada nesse momento — não antes.

## 5.3. Roteamento (Master vs. Isolated Workflows)

Automações sistêmicas padrão operam em um Master Workflow (o backend envia o `tenant_id` e o n8n roteia a lógica internamente). Para contas Early Adopters ou integrações exclusivas, a equipe cria fluxos isolados como diferencial de venda.

## 5.4. Configuração de Automação por Tenant

Tenants que utilizam automação via n8n têm sua configuração (ex: URL de webhook de destino, parâmetros de integração) armazenada no `config_jsonb` de `tenant_modules` (Bloco 1.1.1) — dado opcional, de baixo volume e variável por tenant, dispensando coluna relacional dedicada. Isso permite ativar, configurar ou desativar a automação por tenant sem alteração de schema.

## 5.5. Just-in-Time Credentials

O n8n não armazena API Keys dos clientes. O Backend central descriptografa a chave, envia no webhook efêmero, e o n8n a descarta após o uso, mantendo o ecossistema livre de chaves hardcoded.

## 5.6. Validação com Conta de Teste

Todo workflow novo ou alterado é validado contra credenciais de teste (conta de teste interna, com integrações sandbox) antes de ser promovido para rodar com credencial real de um cliente. Evita que a validação de uma automação nova aconteça diretamente em cima de dados e sistemas de um cliente pagante.

## 5.7. Reverse Callback (Error Trigger)

Falhas em ERPs do cliente travam o n8n. Um nó de erro aciona o backend central, que projeta o alerta visualmente no dashboard do administrador, tirando a culpa (e o suporte) das costas da ferramenta — sujeito à limitação de disponibilidade descrita em 5.2.

---

📦 BLOCO 6: Cérebro de IA e Governança de Execução

## 6.1. Adoção e Shadow Mode

- **A Transição de Confiança:** o Shadow Mode sugere mensagens na tela do vendedor (Zero risco). Quando o Tenant desenvolve confiança operacional, ele pode habilitar o Autopilot a qualquer momento para conversas específicas ou horários designados.

- **Métrica de Confiança do Shadow Mode:** a decisão de habilitar o Autopilot é apoiada por um indicador objetivo, exposto no painel do admin — percentual das sugestões recentes da IA aceitas sem edição pelo vendedor. Reaproveita os mesmos dados já capturados para o Dataset Harvesting (Bloco 8), sem custo adicional de coleta, e transforma a decisão de confiança de subjetiva em orientada a dado.

- **Strict Fallback de RAG:** se a IA não atingir a similaridade vetorial necessária para responder a uma dúvida consultiva, ela aborta o fluxo, não alucina e passa o bastão imediatamente para a tela do atendente humano.

## 6.2. Orquestração de Ações (Function Calling / Tools)

- **Execução Dinâmica:** quando o consumidor solicita uma ação sistêmica (ex: "Agende para amanhã"), a IA estrutura um payload JSON. O Fastify intercepta, repassa para validação estrutural (Zod) e delega a execução real para o n8n ou para métodos diretos no banco de dados.

- **Human-in-the-Loop:** ações marcadas como Críticas (ex: estornos, exclusões) no banco forçam a IA a paralisar o modo autônomo, inserindo um prompt visual (Aprovar/Negar) no Kanban do Vendedor humano.

- **Limites de Negócio como Regra de Código, não como Instrução de Prompt:** parâmetros críticos de qualquer ação executável pela IA (ex: desconto máximo autorizável automaticamente, valor de estorno permitido sem aprovação) são impostos por validação Zod fixa no backend, fora do alcance de qualquer decisão do modelo. Nenhuma tentativa de manipulação via mensagem do consumidor final — por mais sofisticada que seja — consegue produzir uma ação fora desses limites, porque a restrição não depende do comportamento da IA, é verificada de forma determinística antes da execução.

- **Detecção e Alerta de Tentativa de Manipulação:** como camada adicional de visibilidade (não substituta dos limites de negócio acima), a IA é instruída a reconhecer tentativas de manipulação na conversa (ex: pedidos para ignorar políticas, aplicar condições fora do padrão) e, ao identificá-las, chamar uma tool dedicada de alerta (`sinalizar_tentativa_manipulacao`), registrando o contexto e notificando em tempo real, via Socket.io, o vendedor/admin responsável pelo lead — sem interromper a conversa. Por ser um sinal heurístico e não uma garantia, essa detecção nunca é a defesa primária; sua função é dar visibilidade ao time humano mesmo quando a tentativa já foi neutralizada pelos limites de código. Os registros dessas tentativas alimentam a mesma base de Dataset Harvesting do Bloco 8, servindo de base futura para mecanismos de detecção mais robustos.

## 6.3. Governança de Provedores de IA (Multi-Provider Gateway)

- **Camada de Abstração de Provider:** toda chamada a modelo de linguagem passa por um gateway interno único (não a SDK do provedor diretamente espalhada pelo código), que resolve, com base em um mapeamento configurável por tipo de tarefa (`task_model_mapping`), qual provider/modelo é utilizado — permitindo, por exemplo, um modelo mais rápido/barato para triagem e um modelo mais robusto para respostas consultivas complexas, sem acoplar o restante do sistema a um fornecedor específico.

- **Fallback Automático:** se o provider primário de uma tarefa falhar ou expirar por timeout, o gateway tenta automaticamente o provider secundário configurado para aquela tarefa, de forma transparente ao restante do sistema — mitigando o risco de uma instabilidade de um único fornecedor (ex: Groq) derrubar o atendimento de todos os tenants simultaneamente.

- **UX de Degradação Total:** no cenário (raro, mas não descartável) de todos os providers configurados falharem simultaneamente, a interface do vendedor exibe um estado explícito ("IA temporariamente indisponível — atendimento manual"), evitando a percepção de sistema travado ou com bug em um momento que já é crítico por si só.

## 6.4. Governança de Custo (Consumo de IA)

- **Dashboard de Consumo com Zonas de Alerta:** o saldo consumido da wallet é exibido como barra de progresso com zonas de cor (verde/amarelo/vermelho) e valor em reais, com notificações escalonadas em 50%, 25% e 10% de saldo restante, além do Hard Stop em 0% já definido no Bloco 1.3 — garantindo visibilidade da curva de consumo bem antes do limite ser atingido.

- **Rate Limiting Específico de LLM:** limitação de taxa aplicada por tenant e por conversa individual nas chamadas ao modelo de linguagem, independente do rate limiting geral de borda (Bloco 8). Protege contra abuso deliberado (spam de mensagens gerando custo) e contra falhas de automação em loop (erro que gera chamadas repetidas à IA sem intervenção humana) — ambos cenários de consumo anômalo mesmo com saldo de wallet disponível.

---

📦 BLOCO 7: Infraestrutura, Deploy e Escalabilidade

## 7.1. Cloud-Híbrida para Bootstrapping (PMF Phase)

Desenvolvida para alto volume e baixo custo inicial.

- **Serverless Frontend:** Next.js hospedado na Vercel (custo base otimizado, cache global).
- **VPS Conteinerizada (O Motor):** o Backend (Fastify), Socket.io, BullMQ, Redis e n8n rodam via Docker em Máquinas Virtuais (ex: Hetzner, DigitalOcean). Isso assegura que conexões persistentes TCP do WebSocket operem sem explodir faturas de orquestradores Serverless.
- **Banco de Dados Gerenciado:** aproveitamento das camadas gratuitas do Neon DB ou Supabase (PostgreSQL + pgvector) para validar a aplicação antes de transicionar para planos dedicados pesados.
- **Inferência de IA:** roteada pelo Provider Gateway (Bloco 6.3), com Groq como provedor inicial otimizado para LPU, garantindo processamento em milissegundos na camada gratuita e possibilitando o funcionamento do Motor de Cadência Humana — com fallback configurável conforme a estratégia multi-provider evoluir.
- **Custódia de Chave Mestra (AWS KMS):** a chave mestra de criptografia (Bloco 2.2) é gerenciada via AWS KMS — serviço totalmente gerenciado, sem necessidade de hospedar ou operar infraestrutura própria de gestão de segredos. O backend, rodando na VPS, se comunica com o KMS via API (credencial IAM), mantendo a chave fisicamente separada do ambiente de execução da aplicação sem adicionar complexidade operacional de auto-hospedagem.
- **Infraestrutura como Código:** a definição do Docker Compose (Backend, Socket.io, BullMQ, Redis, n8n) é versionada no repositório Git, não configurada manualmente na VPS — permitindo reconstruir o ambiente por completo a partir do repositório em caso de falha grave ou migração de provedor.

## 7.2. Observabilidade

Fundação de confiabilidade da plataforma, construída inteiramente sobre serviços gerenciados com plano gratuito compatível com o volume inicial — sem exigir operação própria de stack de monitoramento:

- **Captura e Banco de Erros (Sentry):** integrado ao backend Fastify, captura automaticamente exceções não tratadas com stack trace completo e contexto customizado (`tenant_id`, `lead_id`), funcionando como o registro centralizado e pesquisável de erros da plataforma. Alertas automáticos (Slack/e-mail) notificam a equipe interna assim que um erro novo ocorre — antes que o cliente precise reportar.

- **Notificação Proativa ao Cliente:** quando um erro impacta uma ação visível ao tenant, o backend agenda um job atrasado no BullMQ (reuso da infraestrutura de fila já existente) para disparo em um intervalo definido (ex: 20-30 minutos). Caso a equipe resolva o problema antes desse prazo, o job é cancelado e o cliente não é notificado. Caso o prazo se esgote sem resolução, a mensagem automática é enviada informando o problema identificado, que já está em tratamento — transformando uma falha técnica em transparência proativa, reforçando a percepção de maturidade da plataforma.

- **Logs Estruturados:** o Fastify utiliza `pino` como logger padrão, gerando logs estruturados (JSON) nativamente. Centralização pesquisável via serviço gerenciado com plano gratuito (ex: Better Stack) é adotada como evolução complementar ao Sentry, não bloqueante para o lançamento inicial.

- **Monitoramento de Disponibilidade (Uptime):** serviço externo (ex: UptimeRobot) realiza checagem periódica dos endpoints principais (API, WebSocket) de fora da infraestrutura própria — cobrindo o cenário em que o processo da aplicação está inteiramente fora do ar e não consegue nem reportar ao Sentry.

- **Alertas de Billing na Infraestrutura:** Billing Alarms nativos da AWS (fatura projetada acima de um teto definido) e monitoramento do plano Vercel são configurados desde o início, complementando a governança de custo de IA (Bloco 6.4) com visibilidade sobre o custo de infraestrutura em si.

## 7.3. Pipeline de Evolução

- **CI/CD (Blue-Green):** commits na `main` disparam o GitHub Actions, compilam as novas imagens Docker e realizam trocas de contêiner sem derrubar as conexões Socket.io ativas dos vendedores.

- **Connection Draining:** ao receber o sinal de encerramento (`SIGTERM`) do orquestrador de containers, o processo do backend para de aceitar novas conexões de socket, permite que as conversas em andamento terminem dentro de um período curto de tolerância, e só então encerra. Como as instâncias compartilham estado via Redis Adapter (Bloco 3.3), novas conexões e reconexões automáticas (State Recovery, Bloco 4.1) migram para o container novo sem quebra de contexto. O container antigo só é removido após o health check do novo confirmar disponibilidade.

- **Backup Restore Drill:** trimestralmente, uma restauração real de backup do banco gerenciado (Neon/Supabase) é executada e validada — não apenas confiar que o backup existe, mas confirmar periodicamente que os dados retornam íntegros.

---

📦 BLOCO 8: Segurança Enterprise e LGPD

Para viabilizar contratos com grandes players corporativos (Bancos, Planos de Saúde):

## 8.1. Segurança em Profundidade — Camadas Complementares

A plataforma sustenta múltiplas camadas independentes de controle, cada uma cobrindo um vetor de risco diferente — nenhuma substitui a outra:

- **RBAC (Role-Based Access Control)** governa o que um usuário humano autenticado pode fazer diretamente pela interface — controle de acesso tradicional, por papel.
- **Human-in-the-Loop (Bloco 6.2)** governa especificamente o que a IA pode executar de forma autônoma via function calling — uma camada de contenção adicional que existe porque decisões de IA estão sujeitas a manipulação ou erro (Bloco 6.2), diferente de uma ação humana direta, que já é de responsabilidade de quem está autenticado.
- **RLS (Bloco 2.1)** garante isolamento de dados entre tenants na camada de banco, independente de qualquer controle de aplicação acima dele.

Essas três camadas operam de forma independente e redundante — a falha de uma não compromete as demais.

## 8.2. Identity & Access Management (IAM)

- MFA (Autenticação Multifator) obrigatório para Administradores.
- JWTs de vida útil ultracurta (15 min), combinados com RBAC rígido em toda a arquitetura de roteamento de API.

## 8.3. Anonymization Engine (LGPD)

Capacidade sistêmica de anonimizar dados e PIIs (Personally Identifiable Information) de consumidores que solicitam exclusão legalmente, transformando rastros de texto em hashes e preservando painéis de BI intactos. Complementar à portabilidade de dados já definida no Bloco 2.3 (Art. 18 da LGPD).

## 8.4. Defesas de Borda (WAF & Rate Limiting)

Todo o tráfego repousa atrás de proteções L7 (Cloudflare). Requisições anômalas ou de massa (Spam de WhatsApp) sofrem Drop pelo Rate Limiting do Redis — salvando as faturas de cobrança da API da Meta e de infraestrutura de LLM, complementado pelo rate limiting específico de LLM por tenant/conversa definido no Bloco 6.4.

## 8.5. AppSec e Telemetria

- Frontend blindado por Content Security Policy (CSP), mitigando XSS.
- Injeção de tokens anti-CSRF.
- **Imutabilidade Analítica:** todo registro de administração gera uma trilha Append-Only no banco de dados.

## 8.6. Dataset Harvesting

Correções humanas durante o Shadow Mode, e registros de tentativas de manipulação detectadas (Bloco 6.2), são categorizados e armazenados em tabelas de Fine-Tuning — preparando terreno de dados valiosos para treinar modelos próprios de IA verticalizados por nicho, base relevante para o Valuation do produto.

- **Opt-in explícito por tenant, não padrão ligado.** Usar conteúdo de conversa para treino de modelo constitui finalidade distinta da finalidade original (atendimento ao cliente), exigindo consentimento próprio sob a LGPD. A ausência de opt-in claro e granular é um dos pontos de maior risco em auditoria SOC 2 e em due diligence de cliente Enterprise regulado — "vocês usam dados dos meus clientes para treinar modelo, por padrão?" é pergunta esperada nesse tipo de negociação, e a resposta precisa ser não.
- **Anonimização obrigatória antes da entrada no dataset de treino.** Identificadores pessoais (nome, telefone, e-mail, CPF) são removidos do conteúdo antes de qualquer uso para fine-tuning — nunca o texto bruto da conversa. Dado de um tenant que não deu opt-in nunca entra no dataset, independentemente de outros tenants terem consentido.

## 8.7. Plano de Resposta a Incidentes

Documento operacional, mantido fora da arquitetura de software mas referenciado por ela, cobrindo cinco etapas: (1) **Detecção**, apoiada pela observabilidade do Bloco 7.2; (2) **Classificação de severidade**, distinguindo incidente reportável (ex: acesso não autorizado a dado de tenant) de falha operacional comum; (3) **Contenção**, com passos imediatos de estancamento (revogação de credencial, isolamento de tenant afetado); (4) **Comunicação**, com ordem e prazos definidos — equipe interna, cliente afetado, e ANPD quando aplicável, conforme exigido pela LGPD; (5) **Post-mortem documentado**, com análise de causa raiz alimentando melhoria contínua.

## 8.8. Residência de Dados (Data Residency)

A região de provisionamento do banco de dados gerenciado (Neon/Supabase) é conhecida e documentada. Para clientes que exijam dados em território nacional (setores regulados como bancos e planos de saúde), ambos os provedores oferecem opção de região no Brasil — migração tratada como decisão de infraestrutura no momento da negociação, não bloqueada pela arquitetura atual.

## 8.9. Certificações Formais (SOC 2 / ISO 27001) — Roadmap Comercial

Não perseguidas de forma antecipada e especulativa. A arquitetura técnica definida nos Blocos 1 a 8 (RLS, criptografia, RBAC, MFA, trilha de auditoria, backup testado, observabilidade) já cobre a maior parte dos controles tipicamente exigidos por uma auditoria SOC 2 Type II — o framework recomendado como ponto de entrada, por ser mais rápido de obter e amplamente aceito no mercado B2B. A busca formal pela certificação é acionada quando um cliente Enterprise concreto a exigir como condição de fechamento, e não antes — momento em que ferramentas de automação de evidência (ex: Vanta, Drata) reduzem significativamente o esforço de auditoria, dado que os controles técnicos de base já existem.
