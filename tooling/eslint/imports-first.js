/** @file Mantém imports estáticos antes da execução do módulo, preservando sua ordem relativa. */
export default {
  meta: {
    type: 'layout',
    fixable: 'code',
    schema: [],
    messages: {
      first: 'Mantenha todos os imports no início do arquivo, antes das declarações e chamadas.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const first = node.body.find(
          (statement) => statement.type !== 'ImportDeclaration' && !statement.directive,
        );

        if (!first) {
          return;
        }

        const late = node.body.filter(
          (statement) =>
            statement.type === 'ImportDeclaration' && statement.range[0] > first.range[0],
        );

        if (!late.length) {
          return;
        }

        context.report({
          node: late[0],
          messageId: 'first',
          fix(fixer) {
            return [
              fixer.insertTextBefore(
                first,
                late.map((statement) => context.sourceCode.getText(statement)).join('\n') + '\n\n',
              ),
              ...late.map((statement) => fixer.remove(statement)),
            ];
          },
        });
      },
    };
  },
};
