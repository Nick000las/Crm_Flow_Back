/** @file Exige um resumo explícito da finalidade de cada arquivo de produção. */
export default {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      missing:
        'Descreva a finalidade deste arquivo em um comentário JSDoc @file antes dos imports.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const firstStatement = node.body[0];
        const comments = context.sourceCode.getAllComments();
        const purpose = comments.find(
          (comment) =>
            comment.type === 'Block' &&
            /@file(?:overview)?\s+[^\n*]{20,}/u.test(comment.value) &&
            (!firstStatement || comment.range[0] < firstStatement.range[0]),
        );

        if (!purpose) {
          context.report({ node, messageId: 'missing' });
        }
      },
    };
  },
};
