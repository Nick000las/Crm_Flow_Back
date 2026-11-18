# Fluxo de trabalho nos quadros nativos

Disponível para cards mantidos pelo Kanban (projetos e postagens). Quadros de entidades, como oportunidades de CRM, continuam sob as regras do seu provedor.

## Recursos

1. **Tempo na etapa**: `etapaDesde` é mantido por trigger e não muda com edições ou reordenações na mesma coluna. A restauração reinicia o relógio. O quadro destaca cards abertos após sete dias; cada coluna pode alterar ou desativar o destaque.
2. **Próxima ação**: `dadosExtras.proximaAcao` contém `titulo`, `data` (calendário), `lembrar` e `concluida`. Lembretes exigem responsável, seguem suas preferências e usam o fuso da empresa.
3. **Bloqueio**: motivo e `bloqueioResponsavelId`. O motivo impede movimentações entre etapas e conclusão, até ser resolvido.
4. **Requisitos de entrada**: por coluna, exigir responsável, prazo e checklist não vazio com todos os itens concluídos. Validação no servidor, inclusive em lote.
5. **Capacidade da coluna**: `wipLimit` continua exibindo aviso quando a quantidade de cards ultrapassa o limite; não impede movimentos.
6. **Automações**: por coluna ou card, atribuir responsável, definir prazo relativo de 0 a 365 dias, concluir e criar uma nova tarefa na etapa. Regras do card prevalecem. Reordenar na mesma coluna não executa novamente. Tarefas geradas recebem responsável e prazo, sem cadeia recursiva de automações.
7. **Recorrência**: diária, semanal ou mensal ao concluir um card com prazo, preservando dados de contexto e reiniciando checklist, próxima ação, bloqueio e dependências. Modelos não geram recorrências.
8. **Dependências**: lista `dadosExtras.dependencias`, até 50 IDs únicos do mesmo quadro. Ciclos são rejeitados. Todas devem estar concluídas para avançar ou concluir. Arquivar não equivale a concluir; dependências concluídas e arquivadas continuam válidas e legíveis. Cards referenciados precisam ser desvinculados antes da exclusão.
9. **Ações em lote**: até 100 cards, com as ações `mover`, `atribuir`, `etiquetar` e `arquivar`. Sem resultados parciais: qualquer falha desfaz a transação. Versão antiga devolve conflito.
10. **Métricas**: histórico de permanência, abertos e bloqueados atuais, conclusões em 30 dias, tempo médio entre criação e primeira conclusão dos cards atualmente concluídos e idade atual por etapa. Modelos não contam; arquivados concluídos contam nas entregas.

## API

- `POST/PATCH /kanban/.../colunas`: acrescenta `regrasFluxo` opcional com `exigirResponsavel`, `exigirPrazo`, `exigirChecklist`, `diasSemMovimento` e `automacao` (`concluir`, `responsavelId`, `prazoDias`, `tarefa`). PATCH omitido preserva regras existentes.
- `POST /kanban/boards/:id/cards/lote`: `{ cards: [{ id, expectedUpdatedAt }], acao, colunaId?, responsavelId?, etiqueta? }`. Campo de destino obrigatório conforme a ação. Retorna `{ total }`.
- `GET /kanban/boards/:id/metricas`: resumo e métricas atuais por etapa.
- Leitura dos cards inclui `dependenciasResolvidas`, limitado ao quadro autorizado.

## Ativação

Aplicar `pnpm db:migrate:deploy` no backend antes de executar o código novo. A migration não exige novas tabelas ou grants. E-mails dependem de `KANBAN_EMAIL_ENABLED`, SMTP e `FRONTEND_URL`, conforme o mecanismo já existente. Nenhuma configuração de envio é habilitada automaticamente.

## Verificação

Testes de regras e schemas; integração HTTP/PostgreSQL com RLS, referências de outra empresa, permissão de leitura, rollback de lote, snapshots antigos, automações, recorrência, dependências arquivadas, dedupe e cancelamento de lembretes. Testes de navegador cobrem os formulários, as quatro ações de lote, métricas e telas de celular, sem SMTP real.
