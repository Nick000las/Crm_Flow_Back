/** @file Impede que transporte, negócio e persistência atravessem suas responsabilidades. */
const DATABASE_METHODS = new Set([
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
  '$transaction',
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'createMany',
  'updateMany',
  'deleteMany',
  'aggregate',
  'upsert',
]);

const ORM_WRITES = new Set([
  'create',
  'update',
  'delete',
  'count',
  'groupBy',
  'findRaw',
  'aggregateRaw',
]);
const DATABASE_RECEIVERS = new Set(['tx', 'transaction', 'prisma', 'db']);

function databaseReceiver(node) {
  let root = node;

  while (root?.type === 'MemberExpression') {
    root = root.object;
  }

  return root?.type === 'Identifier' && DATABASE_RECEIVERS.has(root.name);
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      database:
        'Consultas, gravações e transações ficam no repository; chame uma operação de persistência nomeada.',
      direction:
        'Repository não importa services/controllers nem regras de negócio. A direção é controller → service → repository.',
      domainError:
        'Repository retorna dados e resultados de persistência; autorização e erros de negócio pertencem ao service.',
      unsafe: 'SQL deve continuar parametrizado; não use métodos Unsafe.',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const repository = /(?:\/adapters\/|\/repositories\/).*\.repository\.js$/u.test(filename);
    const application = /\/(?:services|controllers)\//u.test(filename);

    return {
      ImportDeclaration(node) {
        if (
          application &&
          (node.source.value === '#core/db/tenantClient.js' ||
            (node.source.value === '@prisma/client' &&
              node.specifiers.some(
                (specifier) =>
                  specifier.type !== 'ImportSpecifier' || specifier.imported.name !== 'Prisma',
              )))
        ) {
          context.report({ node, messageId: 'database' });
        }

        if (
          repository &&
          /(?:\/services\/|\/controllers\/|\/errors\/app-error\.js$|http\/error-codes\.js$)/u.test(
            node.source.value,
          )
        ) {
          context.report({ node, messageId: 'direction' });
        }
      },
      CallExpression(node) {
        const method =
          node.callee.type === 'MemberExpression'
            ? (node.callee.property.name ?? node.callee.property.value)
            : undefined;

        if (typeof method === 'string' && method.endsWith('Unsafe')) {
          context.report({ node, messageId: 'unsafe' });
        } else if (
          application &&
          (DATABASE_METHODS.has(method) ||
            (ORM_WRITES.has(method) && databaseReceiver(node.callee.object)))
        ) {
          context.report({ node, messageId: 'database' });
        }
      },
      TaggedTemplateExpression(node) {
        const method =
          node.tag.type === 'MemberExpression'
            ? (node.tag.property.name ?? node.tag.property.value)
            : undefined;

        if (['$queryRawUnsafe', '$executeRawUnsafe'].includes(method)) {
          context.report({ node, messageId: 'unsafe' });
        } else if (
          application &&
          node.tag.type === 'MemberExpression' &&
          DATABASE_METHODS.has(method)
        ) {
          context.report({ node, messageId: 'database' });
        }
      },
      NewExpression(node) {
        if (application && node.callee.name === 'PrismaClient') {
          context.report({ node, messageId: 'database' });
        }

        if (repository && node.callee.name === 'AppError') {
          context.report({ node, messageId: 'domainError' });
        }
      },
      ThrowStatement(node) {
        if (repository && node.argument?.type === 'CallExpression') {
          context.report({ node, messageId: 'domainError' });
        }
      },
    };
  },
};
