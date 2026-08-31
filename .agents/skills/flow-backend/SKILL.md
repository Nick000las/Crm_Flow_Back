---
name: flow-backend
description: Implementar e revisar mudanças no backend JavaScript do Flow CRM, incluindo módulos Fastify, autorização, persistência multi-tenant, migrations e eventos Socket.IO. Usar ao trabalhar neste repositório; não rege o frontend.
---

# Padrões do backend Flow CRM

## Fontes e pontos de entrada

Trabalhe na pasta que contém `package.json`. O projeto usa JavaScript ESM e
JSDoc, Fastify, Zod, Prisma e PostgreSQL. Não introduza TypeScript ou outro
framework como parte de uma alteração de funcionalidade.

- Leia [MODULE_CONTRACT.md](../../../MODULE_CONTRACT.md) ao criar ou alterar módulos.
- Use [o padrão de código](../../../docs/padrao-de-codigo.md) e as configurações
  de ESLint/Prettier como referências de formatação. `pnpm lint` executa ESLint.
  Formate somente os arquivos alterados com `pnpm exec prettier --write`.
- Para Kanban, leia [o contrato implementado](../../../docs/kanban-implementado.md)
  e [os campos dos cards](../../../docs/kanban-cards.md).
- Examine um recurso vizinho antes de criar outra abstração. Rotas de plataforma
  ficam em `src/api/routes`; infraestrutura em `src/core`; utilitários sem regras
  de produto em `src/shared`.
- Para busca/detalhe de leads e listas em bancos migrados para oportunidades,
  consulte a [compatibilidade de leitura](../../../docs/crm/compatibilidade-leitura-oportunidades.md).
  Reutilize `crm-lead-read-model.js`: campos comerciais vêm da oportunidade
  principal; as contagens de uso de opções consideram todas as oportunidades.
  Não recrie tabelas antigas para contornar uma diferença de versões.
- O bootstrap em `src/api/server.js` valida `loadEnv()` antes de importar o app,
  pois o app importa módulos de infraestrutura. Preserve essa ordem para que
  erros de configuração apareçam antes da inicialização de Prisma ou Redis.
- Em desenvolvimento, `nodemon.json` acompanha apenas `src`, ignora testes e
  fixtures (`*.test.js`, `testing/`) e agrupa mudanças por 750 ms. Alterar testes
  durante uma validação não deve interromper a API.
  O app fecha conexões HTTP ao reiniciar para não ficar preso em um cliente
  incompleto. Produção mantém as opções padrão de encerramento gracioso.
- No desenvolvimento com `HOST=0.0.0.0`, `listen-options.js` escuta em `::`
  com suporte a IPv4 e IPv6, para atender as duas resoluções de `localhost`.
  Produção e interfaces configuradas explicitamente preservam o endereço.

## Arquitetura e contratos

- Nos módulos, mantenha `controller → service → adapter`. Controllers validam
  entradas e formatam HTTP; services autorizam e aplicam regras; adapters acessam
  dados. Controllers e services não acessam o Prisma diretamente.
- Não importe um módulo de produto a partir de outro. Compartilhamento pertence
  a `core` ou `shared`, segundo o contrato existente.
- Use imports ESM com extensão `.js` e aliases `#core`, `#shared`, `#modules` e
  `#api` para sair do módulo; imports relativos são próprios do módulo.
- Valide parâmetros, body e limites com Zod antes de persistir. Use `schemas/`
  para contratos complexos ou reutilizáveis. Atualize os typedefs e os testes
  quando mudar o formato público.
- Preserve os envelopes `sendSuccess`/`sendError`, os códigos públicos existentes
  e `AppError`. Não envie stack traces ou mensagens cruas de SQL ao cliente.
- Use constantes de HTTP e constantes de domínio para limites; o lint proíbe
  números mágicos. Não desative regras para acomodar uma implementação.

## Restauração de sessão

- `GET /auth/session` faz bootstrap com o mesmo `scope` de `/me`: sem sessão
  válida, devolve `200` com `{ accessToken: null, user: null }`. Não transforme
  erros operacionais 5xx em sessão anônima. O prefixo `/auth` recebe o cookie
  legado e permite migrá-lo para `/` sem sequência de 401/refresh no frontend.

- `GET /me` restaura tenant e `GET /me?scope=admin` restaura MASTER. Aceite
  também Bearer válido, revalide usuário ativo e papel no banco e devolva
  `{ accessToken, user }` com `Cache-Control: no-store`; inclua MFA e os módulos
  e flags atuais. `/auth/me` mantém compatibilidade com clientes anteriores.
- Login, ativação e MFA gravam refresh tokens somente em cookies httpOnly:
  `refresh_token` para tenant e `admin_refresh_token` para MASTER, com `Path=/`,
  `SameSite=Lax` e `Secure` em produção. Nunca misture cookies entre áreas.
- `/auth/refresh` aceita `scope` para selecionar o cookie; o token explícito no
  corpo mantém prioridade por compatibilidade. Migre cookies antigos de
  `Path=/auth` e apague os dois paths no logout da área correspondente.
- `scope=admin` não concede permissão: o usuário do cookie precisa ser MASTER.
  O contexto MASTER pode ter `tenantId: null`; os demais exigem tenant válido.
  MASTER com tenant preserva módulos e flags em `/me`, inclusive no escopo
  admin. Só usuários sem tenant recebem listas vazias. Login, ativação, MFA e
  logout aceitam `scope`: a área define o cookie, sem inferir apenas pelo papel.
- Teste F5 sem Bearer, cookie vencido/adulterado, usuário inativo, MFA,
  coexistência de sessões e logout sem apagar o cookie da outra área.

## Tenant, permissões e exclusões

- O contexto vem da autenticação, nunca de `tenant_id`, role ou autor enviados
  pelo navegador. A interface não substitui autorização no backend.
- Toda query de negócio usa `getTenantClient` dentro de adapters, filtro explícito
  de `tenant_id` e SQL parametrizado por tagged template. Não use métodos Unsafe
  nem concatene SQL com dados do usuário.
- Tabelas de módulo precisam de `tenant_id`, RLS, policy, grants para `app_tenant`
  e referências compostas coerentes entre empresas. `getAdminClient` é reservado
  aos fluxos administrativos existentes, sem contornar o isolamento de módulos.
- O client tenant é inicializado sob demanda. Importar serviços não exige
  `TENANT_DATABASE_URL`; uma operação tenant sem essa variável falha com erro de
  configuração. Nunca use `DATABASE_URL` como fallback: ela conecta como dono e
  pode contornar RLS.
- Aplique permissões por lista explícita de perfis permitidos. No Kanban,
  DONO/MASTER gerenciam quadros e colunas; OPERADOR atua apenas nos quadros dos
  quais participa; atribuições exigem participantes ativos.
- Exclusões validam acesso ao recurso real e suas dependências. Cascatas,
  restrições de coluna ocupada e remoção de atribuições devem ser transacionais.
  O modal de confirmação é responsabilidade do frontend; não acrescente um campo
  `confirmed` à API como substituto da autorização.

- Modelos de quadro enviam `colunasIniciais` apenas na criação (até 10 nomes).
  Quadro, equipe e etapas são persistidos na mesma transação, com ordem desde
  zero e evento após commit. Payload antigo sem etapas continua válido.

## Persistência e tempo real

- Preserve campos específicos dos tipos de quadro ao editar `dados_extras`.
  O contrato de PATCH dos cards mescla campos do objeto e substitui arrays
  enviados. Não converta uma data de prazo sem horário para outro fuso.
- Preserve a verificação de `expectedUpdatedAt` e a política de conflito de cada
  operação. Não sobrescreva silenciosamente uma edição que exige versão atual.
- Publique eventos Socket.IO somente após commit. Salas e audiência são isoladas
  por tenant e acesso ao recurso. Não exponha tokens em URLs ou dados completos
  em eventos que hoje transportam apenas metadados de invalidação.
- PostgreSQL é a fonte de verdade. Redis distribui eventos; reconexão exige
  reconsulta autorizada. A falha ao publicar depois do commit não deve provocar
  repetição de uma mutação já gravada.
- `REDIS_URL` também pode ser compartilhada com filas e cache do CRM. Em
  desenvolvimento, se o Redis estiver ausente ou indisponível no bootstrap,
  Socket.IO usa transporte local em memória; isso não distribui eventos entre
  instâncias. Em produção, Redis é obrigatório para o adapter compartilhado.
- `CORS_ORIGIN` aceita uma origem ou uma lista separada por vírgulas. O parser
  remove espaços e barras finais; para cookies, configure as origens reais do
  frontend, pois a API e o Socket.IO aceitam credenciais.

- Equipes grandes são persistidas em lote parametrizado com `unnest`, depois
  de validar todos os IDs ativos do tenant. Preserve a transação, a remoção de
  atribuições e os eventos após commit; não insira um participante por query.

## Concorrência e consultas independentes

- Use `await Promise.all([consultaA(), consultaB()])` para operações de I/O
  independentes, quando não houver dependência de resultados, autorização ou
  ordem de commit. Inicie todas as chamadas antes de aguardá-las; não coloque
  `await` nos itens do array.
- Não paralelize validação e mutação, criação e uso do ID gerado, consumo de
  código e ativação de senha, aquisição do lock e leitura do estado protegido,
  nem commit e publicação do evento. Preserve as fronteiras de segurança.
- Em uma transação interativa Prisma (`tx`), as queries usam a mesma conexão
  e o banco as executa em série mesmo dentro de `Promise.all`. Não divida uma
  transação em várias conexões para aparentar paralelismo: isso pode perder
  atomicidade, o contexto RLS e os locks que protegem a operação.
- Nesses casos, reduza round trips com consultas em lote ou operações como
  `createMany` quando compatíveis com as regras existentes. Não prometa ganho de
  tempo por adicionar `Promise.all` a chamadas que continuam serializadas.
- `Promise.all` propaga a primeira rejeição e não cancela as outras operações.
  Use-o para resultados exigidos em conjunto; quando resultados parciais forem
  válidos, trate falhas por operação ou use `Promise.allSettled`. Evite disparar
  arrays sem limite que possam esgotar o pool de conexões.
- Consulte a [documentação de transações do Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)
  para a limitação de concorrência dentro de `tx`. Testes de concorrência devem
  verificar início e conclusão das chamadas, não comparar tempos frágeis.

## Migrations e validação

- Após mudar ou integrar `prisma/schema.prisma`, execute `pnpm db:generate`.
  Campo presente no schema, mas desconhecido em `select`, indica client gerado
  desatualizado. `pnpm dev` gera o client antes de iniciar; não remova o campo
  da API para contornar o problema.

- Crie migrations novas; não edite migrations já aplicadas, não use reset e não
  apague o histórico para resolver divergências. Mantenha o Prisma do núcleo e o
  DDL dos módulos coerentes com as responsabilidades descritas no contrato.
- Testes que gravam dados exigem banco isolado de teste. Não use o `.env` da
  aplicação para executar fixtures ou testes destrutivos. Não aplique migrations
  em destinos adicionais por iniciativa da skill.
- Para mudanças de lógica, execute testes relevantes de service/controller ou
  adapter. A suíte isolada atual é:
  `./node_modules/.bin/vitest run --exclude 'src/core/db/__tests__/**'`.
  Integrações opt-in permanecem desativadas sem a configuração de teste.
- Testes unitários de comportamento do cache devem controlar `REDIS_URL` e
  limpar o store e os stubs entre casos. Importar Prisma pode carregar `.env`;
  não dependa da disponibilidade ou do tempo de conexão do Redis real para
  verificar hits e invalidação em memória.
- Alterações de schema ou isolamento exigem os testes de RLS e tenant do contrato
  em banco de teste; Socket.IO entre instâncias exige PostgreSQL e Redis de teste.
- Execute `pnpm lint` antes de concluir. Formate os arquivos alterados com
  Prettier e mantenha
  o lockfile do pnpm ao alterar dependências. Não reformate arquivos sem relação.
- Informe o que mudou, quais verificações passaram e qualquer verificação que não
  pôde executar. Nunca declare uma migration aplicada sem conferir o resultado.

## Histórico, arquivo, permissões e e-mails do Kanban

- As migrations 0010/0011 acrescentam arquivo, limite de coluna, permissão de
  leitura, histórico, preferências e outbox. O gateway define o ator autenticado
  na transação; triggers gravam histórico e fila junto da alteração, sem SMTP
  dentro da transação. O histórico anterior à migration não é reconstruído.
- Participantes `leitor` consultam cards, comentários, histórico e arquivo, sem
  mutações no quadro. DONO/MASTER mantêm gestão. Revalide a permissão também para
  recursos indiretos; a interface não concede acesso.
- Cards arquivados ficam fora do quadro e da reordenação ativa. Restauração usa
  a etapa original; colunas com cards arquivados também não podem ser excluídas.
  O limite WIP é aviso, sem impedir a operação.
- E-mails avisam atribuição, menção explícita e prazo do dia no fuso configurado.
  `mencionados` contém IDs separados do texto do comentário. Valide destinatários
  ativos do tenant e do quadro; não envie ao autor nem a toda a equipe.
- O worker consulta o client de plataforma somente para descobrir tenants ativos
  com módulo habilitado. Leitura de conteúdo, reserva e confirmação da outbox
  passam por `getTenantClient` com RLS. Esta é a exceção operacional de descoberta,
  não uma autorização para consultar dados de módulos pelo client administrativo.
- Revalide acesso, preferência, estado do card e lease antes de enviar. Use lotes
  limitados, SKIP LOCKED, reenvio com espera e Message-ID estável. SMTP oferece
  entrega com possíveis repetições, não exatamente uma vez. Não registre senhas,
  endereços ou conteúdo dos e-mails em logs. Nunca use destinatários reais em testes.

## Organização dos arquivos de IA

- Centralize skills, instruções, regras e contexto de agentes em `.agents/`
  na raiz deste projeto. Consulte as [orientações centrais](../../AGENTS.md).
- Use `.agents/AGENTS.md` como ponto de entrada. Não mantenha instruções de IA
  na raiz nem cópias por ferramenta; configure a leitura desse caminho quando
  a ferramenta não o descobrir automaticamente.
- Guarde referências para agentes em `.agents/references/` quando necessárias.
  Documentação geral e código executável mantêm a organização do projeto.

## Evolução das skills por IAs

- Esta skill pode ser editada pelos agentes que trabalham no projeto. Quando o
  usuário pedir um padrão novo, altere o componente ou contrato de referência,
  a skill e o enforcement adequado na mesma tarefa, sem pedir uma confirmação
  separada apenas para manter a documentação.
- Também incorpore convenções reutilizáveis demonstradas pelo código existente.
  Diferencie requisitos do produto, regras de arquitetura e recomendações.
  Não transforme uma escolha específica de uma tela em obrigação global.
- Substitua orientações antigas que conflitem com o padrão aprovado; não acumule
  regras contraditórias. Preserve as invariantes de autorização, dados e escopo.
- Mantenha `name` e `description` no frontmatter, descrições úteis à descoberta e
  links relativos para os arquivos reais de referência. Se mover uma skill,
  atualize o `.agents/AGENTS.md`. Crie outra skill só para um fluxo realmente distinto.
- Valide o frontmatter com o validador da skill-creator quando disponível,
  confira os links e formate os Markdown alterados. Teste o comportamento do
  componente ou contrato que estabelece o padrão; comparar apenas o texto da
  documentação não valida seu funcionamento.
- Informe os padrões criados ou modificados e as verificações realizadas.
  Editar a skill não concede autorização para outras ações externas ou mudanças
  de infraestrutura fora da tarefa do usuário.
