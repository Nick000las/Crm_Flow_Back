# Padrão de código e legibilidade

Este documento descreve o padrão aplicado ao código existente. ESLint verifica estrutura e responsabilidades; Prettier formata o código. Ambos bloqueiam o `check` quando há divergências, inclusive avisos.

As ferramentas exigem Node.js compatível com `^20.19.0 || ^22.13.0 || >=24`, declarado em `package.json`.

## Formatação e separação de contextos

- Dois espaços, UTF-8, LF, aspas simples, ponto e vírgula e vírgula final. Prettier orienta a quebra em 100 colunas.
- Imports no início do arquivo, agrupados em: efeitos colaterais, módulos Node, dependências, aliases internos e caminhos relativos. A ordem e os nomes importados são corrigidos automaticamente.
- Uma instrução por linha; condicionais sempre com chaves; igualdade estrita; `const` quando não houver reatribuição; sem imports duplicados.
- Separe com linha em branco declarações e execução, validações, blocos de controle, chamadas que ocupam várias linhas e o retorno. Declarações consecutivas do mesmo contexto podem ficar juntas.
- Não una leitura, validação, mutação e retorno em uma sequência compactada. Evite funções com vários assuntos: extraia operações com nomes do domínio.
- Chamadas longas são quebradas pelo Prettier. Prefira objeto nomeado quando houver vários argumentos com significado de negócio; não esconda condições ou efeitos colaterais dentro dos argumentos.
- Não force linhas em branco entre cada campo de objeto, item de array ou setter relacionado: o objetivo é distinguir contextos, não aumentar artificialmente o arquivo.

```js
const input = validarEntrada(request.body);

if (!input.nome) {
  throw erroDeValidacao('nome', 'Informe o nome');
}

const resultado = await salvarRegistro({
  tenantId: context.tenantId,
  nome: input.nome,
});

return resultado;
```

## Finalidade dos arquivos

Todo arquivo de produção em `src/` começa com JSDoc `@file`, antes dos imports. Explique o que ele entrega e seu limite de responsabilidade; não escreva apenas “funções auxiliares”. Testes são identificados pelo nome `*.test.js` e pelo comportamento descrito nas suítes.

```js
/**
 * @file Valida a equipe do quadro e garante o acesso de edição do autor ao salvar.
 * @layer service
 */
```

`@layer` é útil nas camadas de aplicação; `@file` é obrigatório e verificado pelo lint. Documente parâmetros e retornos não óbvios com JSDoc. Comentários explicam intenção e invariantes, sem repetir cada linha do código. Envolva a descrição do cabeçalho em linhas curtas.

## Comandos

Execute na pasta com `package.json`:

```sh
pnpm lint:fix     # corrige imports, espaçamento e formatação
pnpm lint         # verifica ESLint e Prettier sem alterar arquivos
pnpm test:lint    # verifica as regras locais com exemplos válidos e inválidos
pnpm check        # validação completa do projeto
```

O comando de correção executa Prettier, autofix ESLint e Prettier novamente antes da validação final. Isso permite corrigir chaves e quebras de linha na mesma execução, mantendo falha para qualquer erro ou aviso restante.

As regras de legibilidade ficam em `eslint.rules.js`; as específicas do projeto, em `tooling/eslint/`. Não crie configurações divergentes por pasta para fazer o lint passar. Uma exceção precisa ser pontual, explicar o motivo e preservar os contratos existentes.

Migrations já aplicadas, arquivos gerados e lockfiles não são reformatados. A revisão de estilo não autoriza alterar o comportamento dos dados.

## Responsabilidades no backend

A direção é **controller → service → repository**. Adapters de fila, arquivo ou transporte usam sufixo `.adapter.js`; `.repository.js` identifica persistência no banco.

| Camada                     | Deve fazer                                                                                          | Não deve fazer                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `controllers/`             | Validar a estrutura de body/params com schemas, encaminhar contexto e formatar HTTP                 | Consultar o banco, decidir autorização de negócio ou importar repository diretamente              |
| `services/`                | Aplicar autorização e regras, calcular decisões e coordenar operações atômicas                      | Executar Prisma, SQL direto ou abrir conexão/transação por conta própria                          |
| `adapters/*.repository.js` | Buscar, inserir, atualizar e excluir dados, com queries parametrizadas e mapeamento de persistência | Decidir permissão, lançar `AppError`, calcular recorrência/rodízio ou chamar services/controllers |
| `adapters/*.adapter.js`    | Integrar filas, arquivos e outros recursos externos                                                 | Tomar decisões do domínio                                                                         |
| `schemas/`                 | Validar formatos e limites de entrada                                                               | Consultar banco ou definir efeitos colaterais                                                     |
| `constants/` e `types/`    | Compartilhar limites e contratos nomeados                                                           | Executar um fluxo de aplicação                                                                    |

“Repository só acessa o banco” inclui **leituras e gravações**. Mover uma regra para um arquivo chamado service que o repository chama continua invertendo a arquitetura e é bloqueado.

As regras locais impedem acesso direto ao banco em services/controllers, erros de negócio e imports de services em repositories, além de métodos SQL `Unsafe`. O construtor puro `Prisma.sql` pode preparar expressões parametrizadas de filtro/score: ele não abre conexão nem executa query. Importar `PrismaClient` nessas camadas é proibido. Novos fragmentos de persistência independentes devem ficar em `adapters/*.sql.js`.

Listas fechadas de identificadores SQL, serialização de JSON, cláusulas de escopo e agregações executadas pelo banco são detalhes de persistência. Decidir quem pode acessar, qual candidato recebe um lead, quando gerar recorrência e o significado de um resultado pertencem ao service. O lint verifica fronteiras estruturais; a revisão continua avaliando o significado da regra.

## Transações sem perder atomicidade

O repository abre a transação pelo gateway apropriado e entrega o contexto transacional ao callback do caso de uso. O service chama operações nomeadas do repository e pode lançar erros para reverter o conjunto. Ele não usa métodos do Prisma nesse contexto.

```js
// Service: decide e mantém o lock até concluir a gravação.
return withRodizioTransaction(tenantId, async (tx) => {
  await inicializarPonteiro(tx, tenantId, chave);

  const [{ ultimo_usuario_id: ultimo }] = await lerPonteiroBloqueado(tx, tenantId, chave);
  const escolhido = proximoDaVez(candidatos, ultimo);

  await atualizarPonteiro(tx, tenantId, chave, escolhido);

  return escolhido;
});
```

RLS, filtros explícitos de `tenant_id`, locks e publicação de eventos depois do commit são invariantes. Não fragmente uma transação em várias conexões apenas para separar arquivos.

## Formatação das queries

SQL completo em `$queryRaw`, `$executeRaw` e `Prisma.sql` usa PostgreSQL com palavras-chave em maiúsculas, cláusulas e projeções em linhas próprias, listas e predicados indentados. O lint aplica o formatador; não formate queries com substituições de texto manuais.

```js
export function buscarCard(tx, { tenantId, cardId }) {
  return tx.$queryRaw`
    SELECT
      id,
      titulo
    FROM
      modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
  `;
}
```

O autofix preserva as expressões interpoladas, sua ordem e os literais. Fragmentos parciais, como `AND campo = ${valor}`, continuam sendo compostos pelo construtor parametrizado e não são tratados como statements completos. Não execute strings concatenadas, não interpole nomes recebidos do usuário e não use `$queryRawUnsafe`/`$executeRawUnsafe`.

## Referências concretas

- `kanban-universal/adapters/kanban.repository.js`: operações de SQL e abertura de transação; cada query tem nome e parâmetros explícitos.
- `kanban-universal/services/native-kanban.service.js`: snapshot, autorização, transação e despacho do caso de uso.
- `kanban-universal/services/native-kanban-{boards,columns,card-details,card-movement,comments,batch,reports}.service.js`: regras por contexto.
- `kanban-universal/services/board-members.service.js`: participação e seleção de equipe; seu repository somente lê/grava.
- `crm/services/rodizio.service.js`: escolhe o próximo candidato; `crm-rodizio.repository.js` bloqueia e atualiza o ponteiro.
- `core/auth/login/services/password-recovery-transaction.service.js`: cooldown e consumo único; o repository oferece operações de persistência atômicas.

Os testes dos casos de uso acompanham a camada `services/`; integrações de persistência e RLS ficam com os adapters. `pnpm test:lint` exercita as proibições e o autofix SQL; os testes do domínio garantem que o estilo e a separação não mudaram o comportamento.

## Integração contínua e referências

`pnpm check` reúne lint, testes das regras e testes da aplicação. Testes de banco usam uma instância descartável; jamais use o banco de produção para validar uma refatoração. O workflow de PR verifica também formatação, isolamento de tenant e integridade das FKs.

O contrato completo está em [MODULE_CONTRACT.md](../MODULE_CONTRACT.md). As orientações para agentes ficam em [.agents/AGENTS.md](../.agents/AGENTS.md) e na [skill do backend](../.agents/skills/flow-backend/SKILL.md).
