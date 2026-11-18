/** @file Formata SQL PostgreSQL em tagged templates sem avaliar ou substituir parâmetros. */
import { format } from 'sql-formatter';

const SQL_TAGS = new Set(['$queryRaw', '$executeRaw', 'sql']);
const FULL_STATEMENT =
  /^\s*(?:--[^\n]*\n\s*)*(SELECT|INSERT|UPDATE|DELETE|WITH|EXPLAIN|SET|CREATE|ALTER)\b/iu;
const MARKER_PREFIX = '$987654';

/** Não formata strings comuns ou fragmentos parciais do construtor Prisma.sql. */
export function isSQLTemplate(node) {
  return node.tag.type === 'MemberExpression' && SQL_TAGS.has(node.tag.property.name);
}

export function formatSQLTemplate(node, sourceCode) {
  const raw = node.quasi.quasis.map((part) => part.value.raw).join('');
  let markerPrefix = MARKER_PREFIX;

  while (raw.includes(markerPrefix)) {
    markerPrefix += '9';
  }

  const markerPattern = new RegExp('\\' + markerPrefix + '(\\d+)', 'gu');
  const markers = node.quasi.expressions.map((_expression, index) => `${markerPrefix}${index}`);
  const sql = node.quasi.quasis
    .map((part, index) => part.value.raw + (markers[index] ?? ''))
    .join('');

  if (!FULL_STATEMENT.test(sql)) {
    return null;
  }

  const formatted = format(sql, {
    language: 'postgresql',
    keywordCase: 'upper',
    tabWidth: 2,
    expressionWidth: 80,
    linesBetweenQueries: 1,
  });
  // Cada expressão aparece na mesma ordem e exatamente uma vez após a formatação.
  const found = formatted.match(markerPattern) ?? [];

  if (found.length !== markers.length || found.some((marker, index) => marker !== markers[index])) {
    throw new Error('O formatador alterou a posição dos parâmetros SQL.');
  }

  const indentation = sourceCode.lines[node.loc.start.line - 1].match(/^\s*/u)[0];
  let template =
    '\n' +
    formatted
      .split('\n')
      .map((line) => indentation + '  ' + line)
      .join('\n') +
    '\n' +
    indentation;

  // Callback de replace conserva literalmente $, crases e escapes das expressões JS.
  template = template.replace(
    markerPattern,
    (_marker, index) => '${' + sourceCode.getText(node.quasi.expressions[Number(index)]) + '}',
  );

  return '`' + template + '`';
}

export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: {
      format: 'Formate esta query PostgreSQL em múltiplas linhas (pnpm lint:fix).',
      invalid:
        'Não foi possível formatar o SQL: {{reason}}. Revise a query ou documente uma exceção pontual.',
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node) {
        if (!isSQLTemplate(node)) {
          return;
        }

        let formatted;

        try {
          formatted = formatSQLTemplate(node, context.sourceCode);
        } catch (error) {
          context.report({
            node,
            messageId: 'invalid',
            data: { reason: error.message.split('\n')[0] },
          });

          return;
        }

        if (formatted && formatted !== context.sourceCode.getText(node.quasi)) {
          context.report({
            node: node.quasi,
            messageId: 'format',
            fix: (fixer) => fixer.replaceText(node.quasi, formatted),
          });
        }
      },
    };
  },
};
