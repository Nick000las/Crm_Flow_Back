# Cards do Kanban: recursos e evolução

## Implementado nesta refatoração

- Card compacto no quadro: título, descrição resumida, responsável, etiquetas,
  prioridade, prazo e contagem de itens concluídos.
- Editor responsivo com campos da tarefa e uma área separada para comentários.
- Prioridade explícita: sem prioridade, baixa, média, alta e urgente.
- Prazo por data, sem conversão de fuso, com indicação de atraso, vencimento hoje
  e entrega concluída. A conclusão do prazo é manual; não depende do nome da coluna.
- Etiquetas por card: nome e seis opções de cor, até 12 por card. O nome continua
  visível para que a categoria não dependa apenas da cor.
- Checklist com inclusão, edição, remoção, conclusão de itens e progresso, até
  100 itens. Os itens são salvos junto com o card no botão Salvar card.
- Busca em título, descrição e etiquetas; filtros por prioridade, responsável e prazo.
- Comentários continuam sendo gravados separadamente e atualizados por Socket.IO.
- Aviso de alterações não salvas ao fechar o editor e preservação de rascunhos
  durante eventos em tempo real. Edição concorrente mostra aviso e permite
  carregar a versão atual antes de salvar.

## Lista para as próximas entregas

| Ordem sugerida | Recurso                              | Aplicação no CRM                                                     | Dependências                                                         |
| -------------- | ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1              | Histórico de atividades              | Registrar quem mudou prioridade, prazo, responsável e etapa          | Tabela de auditoria por tenant e eventos gravados na mesma transação |
| 2              | Anexos e links                       | Reunir contratos, briefings e documentos do cliente                  | Storage privado, autorização de download e limites de upload         |
| 3              | Arquivar e restaurar                 | Retirar tarefas antigas sem apagar o histórico                       | Campos de arquivamento, filtros e política de retenção               |
| 4              | Notificações e menções               | Avisar sobre atribuição, comentário e vencimento                     | Preferências, fila de envio e agendamento de lembretes               |
| 5              | Catálogo de etiquetas do quadro      | Reutilizar nomes e cores e filtrar todos os cards da categoria       | Tabela de etiquetas e associações com cards                          |
| 6              | Modelos e duplicação                 | Padronizar onboarding, vendas e entregas recorrentes                 | Cópia controlada, modelos por quadro e reinicialização de datas      |
| 7              | Múltiplos participantes e seguidores | Separar o responsável principal dos colaboradores                    | Associações de usuários e regras de notificação                      |
| 8              | Campos personalizados                | Registrar valor, produto, origem ou SLA conforme o tipo de quadro    | Definições de campos, validação e índices para consulta              |
| 9              | Checklist avançado                   | Atribuir uma pessoa e um prazo para cada item                        | Modelo próprio de itens, permissões e lembretes                      |
| 10             | Calendário e visualização em lista   | Planejar entregas por data e comparar tarefas                        | Consultas paginadas com filtros e estados compartilhados             |
| 11             | Automações                           | Ao mudar de etapa, atribuir pessoa, criar checklist ou definir prazo | Motor de regras com prevenção de ciclos e execução idempotente       |
| 12             | Dependências e bloqueios             | Mostrar tarefas impedidas por outra entrega                          | Relações entre cards, validação de ciclos e indicadores              |
| 13             | Limites de trabalho e métricas       | Limitar trabalho em andamento e medir tempo de ciclo                 | Configuração por coluna e histórico durável de movimentações         |

A lista é uma proposta de evolução do Flow CRM. Não representa recursos já
entregues nem pretende reproduzir todas as funcionalidades ou planos do Trello.

Referências oficiais: [detalhes dos cards](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/),
[checklists](https://support.atlassian.com/trello/docs/adding-checklists-to-cards/),
[etiquetas](https://support.atlassian.com/trello/docs/adding-labels-to-cards/),
[campos personalizados](https://support.atlassian.com/trello/docs/using-custom-fields/)
e [filtros](https://support.atlassian.com/trello/docs/search-filter-and-custom-views/).

## Contrato técnico e compatibilidade

Os campos comuns ficam no JSONB `cards.dados_extras`, já existente. Não há nova
migration. Campos específicos de tipos de quadro são preservados no backend ao
aplicar um PATCH parcial. Arrays `etiquetas` e `checklist` são substituídos por
inteiro quando enviados; listas vazias removem todos os itens. `prazo: null`
remove a data. Descrição aceita até 20.000 caracteres.

Exemplo de `dadosExtras`:

```json
{
  "descricao": "Revisar os critérios com a equipe",
  "prioridade": "alta",
  "prazo": "2026-10-20",
  "prazoConcluido": false,
  "etiquetas": [{ "id": "18e67679-4608-4619-a169-6f29f48e8e06", "nome": "Cliente", "cor": "azul" }],
  "checklist": [
    { "id": "d275dc73-588d-4d2c-9d38-34aa2db8bda7", "titulo": "Revisar", "concluido": false }
  ]
}
```

O editor envia `expectedUpdatedAt` no PATCH do card. O servidor verifica a versão
sob o lock transacional existente e retorna 409 se ela estiver desatualizada,
sem gravar nem publicar evento. Clientes antigos que não enviam a versão mantêm
o comportamento anterior. A movimentação continua com a política própria de
conflito descrita em [Kanban Universal](kanban-implementado.md).

Somente usuários com acesso ao quadro podem alterar esses dados. Criar quadros
continua restrito a DONO e MASTER; os participantes OPERADOR podem trabalhar nos
cards de seus quadros.
