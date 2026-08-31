# Orientações para agentes — Flow CRM Backend

Antes de alterar código neste repositório, leia a skill local
[flow-backend](skills/flow-backend/SKILL.md).
Ela reúne o fluxo de implementação, os contratos existentes e a validação
adequada para este backend. Consulte os documentos vinculados conforme a tarefa.

O contrato de arquitetura é [MODULE_CONTRACT.md](../MODULE_CONTRACT.md).
As configurações reais de ESLint, Prettier e os scripts de `package.json`
prevalecem sobre exemplos antigos de documentação. Ao mudar um padrão aprovado,
atualize o código de referência e a skill correspondente na mesma entrega.

As skills são documentos versionados e evolutivos. As IAs podem e devem
atualizá-las durante a tarefa quando o usuário definir um padrão novo ou quando
um padrão reutilizável for incorporado ao código. Essa manutenção faz parte da
implementação e não exige uma autorização adicional. Siga a seção de evolução
da própria skill e informe no resultado quais padrões foram atualizados.

## Organização dos arquivos de IA

Centralize instruções, skills, regras e contexto para agentes em `.agents/`,
relativo à pasta do projeto que contém `package.json`. Use `skills/` para skills
e `references/` para contexto complementar, criando arquivos apenas quando úteis.
O ponto de entrada é `.agents/AGENTS.md`. Não mantenha arquivos de instruções
de IA na raiz nem crie outra pasta por ferramenta. Configure a ferramenta para
ler este ponto de entrada quando necessário. Atualize referências ao mover arquivos.
Documentação do produto e código executável continuam em seus diretórios próprios.

Ao alterar persistência ou módulos, consulte as
[regras multi-tenant](references/multi-tenant.md).
