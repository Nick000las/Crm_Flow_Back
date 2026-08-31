# Padrão de código

Backend e frontend usam ESLint para qualidade e Prettier para formatação.
Cada projeto tem configuração própria para funcionar também fora deste workspace.

- Dois espaços, aspas simples, ponto e vírgula e vírgula final.
- Quebra de linhas orientada a 100 caracteres pelo Prettier.
- Blocos com chaves obrigatórios, inclusive em condicionais de uma linha.
- No máximo uma instrução por linha.
- Igualdade estrita, `const` quando possível, sem `var` nem imports duplicados.
- O lint falha também em avisos. As regras de arquitetura e React continuam ativas.

Execute os comandos na pasta que contém o `package.json` de cada projeto:

```sh
pnpm lint:fix
pnpm format
pnpm lint
pnpm format:check
```

`pnpm check` reúne lint, verificação de formatação e testes; no frontend,
também executa o build. Os testes de isolamento do backend precisam do banco.

Configure o editor para usar Prettier ao salvar. O `.editorconfig` define
indentação, UTF-8 e fim de linha LF. Não edite migrations já aplicadas para
adequar formatação: elas estão excluídas do Prettier.

## Orientações para agentes

O ponto de entrada é [AGENTS.md](../.agents/AGENTS.md), que direciona à skill local
[flow-backend](../.agents/skills/flow-backend/SKILL.md). A skill reúne as convenções
operacionais e referencia o contrato de módulos, sem substituir o ESLint.

## Operações independentes

Use `Promise.all` para iniciar e aguardar operações independentes no mesmo fluxo.
Preserve a ordem quando houver dependência, autorização ou atomicidade. Dentro de
uma transação interativa Prisma, as queries usam uma única conexão e continuam
sequenciais; prefira reduzir round trips com queries em lote quando aplicável.
A skill local detalha esses critérios e o tratamento de falhas parciais.

## Organização das instruções de IA

Skills, regras e contexto para agentes ficam em `.agents/`, dentro deste projeto.
O ponto de entrada é `.agents/AGENTS.md`; não mantenha arquivos de instruções
de IA na raiz. Configure a ferramenta para ler esse caminho quando necessário.
Mantenha as regras centralizadas e atualize os links quando a estrutura evoluir.
