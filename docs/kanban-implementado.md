# Kanban Universal

A tela `/kanban` consome as tabelas existentes `boards`, `colunas`, `cards` e
`card_comments`. Não utiliza dados fictícios nem armazenamento local.

Antes de usar, execute `npm run db:migrate:deploy` no backend com o banco de
destino configurado e habilite `kanban_universal` na gestão de módulos da empresa.
A migration `0008_kanban_integrity` acrescenta constraints compostas e índices;
referências antigas inconsistentes fazem a migration falhar, sem correção ou
remoção automática de dados. Faça backup e corrija as referências indicadas pelo
PostgreSQL antes de reaplicar.

Donos e masters gerenciam quadros e colunas. Operadores podem consultar,
criar, editar, mover e excluir cards; só podem excluir seus próprios comentários.
Donos e masters também podem moderar comentários.

Todas as rotas passam por autenticação, gate de módulo e gateway de tenant.
Movimentações e alterações são serializadas por tenant com advisory lock
transacional; a origem e o destino são reordenados atomicamente. Uma coluna
ocupada retorna conflito ao excluir. A exclusão de um quadro remove seus cards
e comentários após confirmação na interface. `expectedUpdatedAt` detecta versões
antigas em movimentações e retorna `conflito: true`, mantendo last-write-wins.
Na edição de conteúdo, `expectedUpdatedAt` recusa versões antigas com 409.
Os novos campos e a lista de evolução estão em [Cards do Kanban](kanban-cards.md).

A interface usa movimento otimista com restauração e erro visível em falhas.
O arraste move o card para o final da coluna. Os controles Subir/Descer permitem
posicionamento exato; o seletor de etapa permite movimentação por teclado.
O diálogo nativo controla foco e Escape. O estado é sincronizado por Socket.IO
sobre WebSocket. A atualização periódica foi removida. A interface faz leitura
completa ao reconectar e mantém a opção de atualização manual.

O tipo do quadro é um identificador; selecionar `crm_leads` não cria ou migra
leads. Os registros relacionais de CRM e `funil_estagio_id` permanecem separados.
A integração automática de leads exige uma migration de associação e migração
de etapas para evitar duas fontes de verdade.

Validação: `npm run lint` em ambos os projetos, `npm run build` no frontend,
`npm test` no backend. RLS e isolamento exigem acesso ao PostgreSQL configurado.
Os testes isolados podem ser executados com
`./node_modules/.bin/vitest run --exclude 'src/core/db/__tests__/**'`.

## Gestão de quadros e equipes

A entrada `/kanban` apresenta uma galeria dos quadros disponíveis ao usuário,
com busca por nome e cards que mostram tipo de uso e número de participantes. O card abre a área de
trabalho em `/kanban?quadro=<id>`, com retorno à galeria. Criação, edição, exclusão
e seleção de participantes ficam em `/kanban/quadros`, disponível para DONO e MASTER.
A seleção de participantes usa usuários ativos da mesma empresa. O criador é
incluído automaticamente na equipe inicial. A gestão pode atualizar a equipe
junto com o nome do quadro numa única transação.

A migration `0009_kanban_board_members` cria `board_members` com RLS e referências
compostas a quadro e usuário. Os quadros existentes recebem os usuários ativos
da empresa como participantes para preservar o acesso anterior. Novos usuários
não são incluídos automaticamente nos quadros existentes.

Operadores só visualizam e alteram quadros dos quais participam. A validação
abrange leitura/listagem, cards, movimentações e comentários, inclusive quando
o endpoint recebe apenas o ID de card ou comentário. DONO e MASTER mantêm
acesso de gestão a todos os quadros do próprio tenant. Somente participantes
ativos podem receber atribuições de cards. Ao remover um participante, suas
atribuições no quadro são limpas na mesma transação. Uma equipe vazia deixa o
quadro acessível somente à gestão.

Endpoints adicionais:

- `GET /kanban/boards/:id/membros`: participantes do quadro acessível.
- `PUT /kanban/boards/:id/membros`: substitui a equipe, somente para gestão.
- `POST /kanban/boards` e `PATCH /kanban/boards/:id` aceitam `participantes`,
  uma lista sem repetições de UUIDs de usuários ativos da empresa.

O teste `pnpm test:kanban:integration` usa o banco de teste configurado, com as
migrations aplicadas. Exercita as rotas HTTP autenticadas, a persistência da
equipe, a revogação de acesso, o rollback e as constraints entre empresas.

## Socket.IO e Redis

Configure `REDIS_URL` no backend. Desenvolvimento e produção usam o Redis Adapter
mesmo com uma única instância. Somente testes com `NODE_ENV=test`, sem URL de
Redis na configuração explícita, podem usar o adapter em memória. O prefixo
`SOCKET_REDIS_PREFIX` deve ser igual nas instâncias do mesmo ambiente e diferente
entre ambientes que compartilhem um Redis. O `compose.yaml` fornece Redis 7 local.

O transporte WebSocket fica em `/socket.io`; o namespace do produto é `/kanban`.
O proxy do backend deve encaminhar o upgrade WebSocket desse endpoint. Não há
fallback para long polling. O token é enviado no campo de autenticação do socket,
nunca na URL. O handshake valida JWT, usuário ativo e módulo contratado.

A conexão ingressa numa sala de usuário que inclui `tenantId` e `userId`. O evento
`kanban:watch` valida o acesso ao quadro e, opcionalmente, ao card antes de
inscrever nas respectivas salas. `kanban:unwatch` remove a inscrição. Salas de
quadros e cards sempre incluem o tenant. Não há um comando de join arbitrário
aceito do navegador.

As gravações continuam nas rotas HTTP autenticadas. O serviço publica apenas
quando a transação foi confirmada. `kanban:changed` contém ID do evento, tipo da
alteração, IDs de quadro/card, autor e indicador de conflito; o conteúdo completo
é consultado pela API com as permissões atuais. Os destinatários são revalidados
no banco em cada publicação e os eventos são direcionados às salas de usuários
ativos autorizados. Participantes removidos recebem `kanban:access-revoked` e a
interface fecha o quadro e seus diálogos. Eventos posteriores não são entregues
a essas pessoas.

A mesma conexão acompanha galeria, gestão e quadro aberto. Alterações recebidas
durante uma gravação local aguardam seu término para preservar o movimento
otimista. Comentários são atualizados com o card aberto sem substituir o texto
do formulário. Ao cair a conexão, a interface exibe “Reconectando…”. Ao retornar,
revalida as inscrições e faz leitura completa. A indisponibilidade e o retorno do
Redis também atualizam o indicador e provocam recuperação do estado após retorno.
Os eventos não constituem um histórico durável; a recuperação usa o PostgreSQL
como fonte de verdade.

O servidor encerra sockets ao expirar o access token. O frontend usa o refresh
single-flight da sessão e autentica uma nova conexão com o novo token. Sair da
sessão ou do módulo desconecta o socket.

`pnpm test:kanban:integration`, com `KANBAN_TEST_REDIS_URL` configurada, também
exercita duas instâncias com o mesmo Redis, entrega após commit, validação de
salas, isolamento de empresas, revogação e expiração de sessões. O CI fornece
Redis e PostgreSQL para esses testes.

## Modelos iniciais e apresentação da equipe

A criação oferece Básico, Projetos, Comercial, Conteúdo, Atendimento e Em branco, com prévia
das etapas. O modelo é independente do tipo do quadro; não importa leads nem
cria cards. As colunas podem ser alteradas depois pela gestão.

`POST /kanban/boards` aceita `colunasIniciais`, array opcional de até 10 nomes
não vazios com até 200 caracteres. Nomes são normalizados com trim. Omissão ou
array vazio cria sem colunas, preservando clientes antigos. Quadro, equipe e
colunas são gravados na mesma transação; as etapas usam a ordem do array,
começando em zero. Não há alteração de schema ou migration.

Consulta e seleção da equipe ficam em Gerenciar quadros. A tela de trabalho
não exibe resumo nem lista de participantes; os seletores de responsável nos
cards e filtros continuam disponíveis.

## Seleção de equipes grandes

O formulário mantém a seleção por ID, independente dos checkboxes renderizados.
Há busca por nome sem distinção de acentos, filtros de todos/selecionados/disponíveis
e paginação de 20 funcionários. Adicionar/remover resultados atua em todas as
páginas do filtro atual; o contador mostra a seleção total. Nada é persistido
antes de salvar o quadro e falhas preservam as escolhas. A listagem da empresa
continua sendo carregada pela API existente, com filtragem e paginação locais.

A persistência valida os usuários ativos do tenant antes de alterar a equipe
e usa uma inserção em lote com `unnest`, evitando uma query por participante.
A limpeza de atribuições dos removidos continua na mesma transação.

## Ferramentas, histórico e arquivamento

A barra reúne busca, filtros de prioridade/responsável/prazo, contagem e limpeza.
Atalhos: Meus cards, Atrasados e Prioridade alta. Até 10 filtros personalizados
são salvos por usuário/quadro neste navegador. Eles não são sincronizados entre
dispositivos. Cards mostram referência curta, título, descrição resumida,
prioridade, prazo e responsável. O arraste indica inserção antes/depois e mantém
a alternativa acessível por teclado. Filtros ativos desabilitam o arraste.

Cada coluna aceita `wipLimit` opcional (inteiro positivo ou null); atingir ou
ultrapassar o valor mostra aviso. Não bloqueia movimentação nem criação.

`PATCH /kanban/cards/:id/arquivar` e `/restaurar` aceitam `expectedUpdatedAt`.
Arquivo preserva dados e comentários; restauração insere no fim da coluna
original. Colunas com cards arquivados não podem ser removidas.
`GET /kanban/boards/:id/arquivados` lista o arquivo autorizado.
`GET /kanban/cards/:id/activities` retorna as últimas 100 atividades.
O histórico começa com a implantação e registra criação, conteúdo, movimentação,
entrega concluída, comentários, arquivo e restauração, com ator e horário.
Não é uma trilha imutável para auditoria regulatória.

Criação/edição de quadro aceitam `permissoes: [{ id, permissao }]`, sendo a
permissão `editor` ou `leitor`, apenas para participantes selecionados. O padrão
é editor; permissões omitidas dos participantes existentes são preservadas.
Leitor consulta sem criar, editar, mover, arquivar, comentar ou excluir. Gestão
continua exclusiva de DONO/MASTER. A API do quadro retorna `canEdit`.

## Notificações por e-mail

As migrations `0010_kanban_professional` e `0011_kanban_comment_mentions` incluem
outbox, histórico e preferências com RLS e referências compostas por tenant.
Os avisos são criados na transação e enviados depois do commit pelo worker,
sem atrasar ou reverter a gravação em caso de falha SMTP.

- Atribuição: somente ao novo responsável, quando diferente do autor.
- Menção: comentário envia `mencionados: UUID[]` separado do texto legível;
  somente participantes ativos da mesma empresa recebem, excluindo o autor.
- Prazo: um lembrete no dia do prazo, ao responsável, por card/data/responsável,
  ignorando cards arquivados ou com entrega concluída.

`GET/PUT /kanban/email-preferences` consulta/salva `{ enabled: boolean }` do
usuário autenticado. A opção E-mails controla esse recebimento. A preferência
padrão é habilitada. Revogações, desativação do módulo, alteração de responsável,
arquivamento e preferência são revalidados antes de enviar.

Configuração: SMTP existente (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_TIMEOUT_MS`), `FRONTEND_URL` com a URL pública do frontend,
`KANBAN_EMAIL_ENABLED` (padrão true) e `KANBAN_EMAIL_TIMEZONE`
(padrão America/Sao_Paulo). Em produção, a URL deve apontar para o domínio real.
Sem SMTP ou FRONTEND_URL o worker avisa no log e não envia. Reinicie o backend
após ajustar o ambiente. Em NODE_ENV=test o worker não inicia.

O worker percorre tenants ativos com módulo contratado, a cada 60 segundos,
com lotes de 10 avisos e reserva por 5 minutos usando SKIP LOCKED. Cada aviso tem
até 5 tentativas, espera progressiva de 5 minutos por tentativa e Message-ID
estável. Após esgotar tentativas, o status fica failed para diagnóstico. SMTP
não garante exatamente uma entrega: falha após aceitação pode gerar repetição.
O backend precisa permanecer em execução para processar avisos; não depende de
haver um navegador aberto. O client administrativo só descobre tenants elegíveis;
a fila e o conteúdo são sempre consultados com o gateway RLS do tenant.
