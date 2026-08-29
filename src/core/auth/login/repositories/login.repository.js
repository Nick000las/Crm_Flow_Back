import { getAdminClient } from '#core/db/tenantClient.js';

/** @typedef {import('@prisma/client').Prisma.TransactionClient} TransactionClient */

/**
 * O login ainda não possui contexto de tenant, portanto esta consulta é uma
 * das operações administrativas permitidas antes da criação do JWT.
 *
 * @param {{ email: string }} input
 */
export async function getUserEmailAndPassword({ email }) {
  return getAdminClient().usuario.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
    },
    select: {
      id: true,
      email: true,
      tenantId: true,
      senhaHash: true,
      role: true,
      ativo: true,
    },
  });
}

/** @template T @param {(repository: ReturnType<typeof createTransactionRepository>) => Promise<T>} operation */
export async function runInTransaction(operation) {
  return getAdminClient().$transaction((tx) => operation(createTransactionRepository(tx)));
}

/** @param {{ usuarioId: string, proposito: string }} input */
export async function getLatestCodigoVerificacao({ usuarioId, proposito }) {
  return getAdminClient().codigoVerificacao.findFirst({
    where: { usuarioId, proposito },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      codigoHash: true,
      expiraEm: true,
      usadoEm: true,
      tentativas: true,
      createdAt: true,
    },
  });
}

/**
 * Compensa um envio de e-mail que falhou para que um código não entregue
 * não bloqueie uma nova tentativa pelo cooldown. Escopado por `id` — não
 * precisa de `proposito` no filtro, o id já é inequívoco.
 *
 * @param {{ codigoId: string, usuarioId: string, usadoEm: Date }} input
 */
export async function invalidateCodigoVerificacao({
  codigoId,
  usuarioId,
  usadoEm,
}) {
  return getAdminClient().codigoVerificacao.updateMany({
    where: {
      id: codigoId,
      usuarioId,
      usadoEm: null,
    },
    data: { usadoEm },
  });
}

/**
 * Escopado por `id` — não precisa de `proposito` no filtro.
 *
 * @param {{ codigoId: string, validAfter: Date, maxAttempts: number, incrementBy: number }} input
 */
export async function incrementCodigoVerificacaoAttempts({
  codigoId,
  validAfter,
  maxAttempts,
  incrementBy,
}) {
  return getAdminClient().codigoVerificacao.updateMany({
    where: {
      id: codigoId,
      usadoEm: null,
      expiraEm: { gt: validAfter },
      tentativas: { lt: maxAttempts },
    },
    data: { tentativas: { increment: incrementBy } },
  });
}

/**
 * `senhaHash` faz parte do select porque `disableMfa` precisa revalidar a
 * senha antes de desligar a proteção (só quem prova ser dono da conta pode
 * reduzir segurança) — nenhum chamador atual repassa esse campo cru numa
 * resposta HTTP.
 *
 * @param {{ userId: string }} input
 */
export async function getUserById({ userId }) {
  return getAdminClient().usuario.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      role: true,
      ativo: true,
      senhaHash: true,
    },
  });
}

/** @param {{ userId: string, ativo: boolean }} input */
export async function setMfaAtivo({ userId, ativo }) {
  return getAdminClient().usuario.update({
    where: { id: userId },
    data: { mfaAtivo: ativo },
    select: { id: true, mfaAtivo: true },
  });
}

/** @param {TransactionClient} tx */
function createTransactionRepository(tx) {
  return {
    /**
     * Precisa de `proposito` no filtro — sem ele, gerar um código novo (ex:
     * MFA) invalidaria por engano um código pendente de outro propósito
     * (ex: ativação de senha) do mesmo usuário.
     *
     * @param {{ usuarioId: string, usadoEm: Date, proposito: string }} input
     */
    invalidateUnusedCodigosVerificacao: ({ usuarioId, usadoEm, proposito }) =>
      tx.codigoVerificacao.updateMany({
        where: { usuarioId, proposito, usadoEm: null },
        data: { usadoEm },
      }),

    /**
     * @param {{ usuarioId: string, tenantId: string, codigoHash: string, expiraEm: Date, proposito: string }} input
     */
    createCodigoVerificacao: ({ usuarioId, tenantId, codigoHash, expiraEm, proposito }) =>
      tx.codigoVerificacao.create({
        data: { usuarioId, tenantId, codigoHash, expiraEm, proposito },
        select: { id: true },
      }),

    /**
     * Escopado por `id` — não precisa de `proposito` no filtro.
     *
     * @param {{ userId: string, codigoId: string, usadoEm: Date, validAfter: Date }} input
     */
    consumeCodigoVerificacao: ({ userId, codigoId, usadoEm, validAfter }) =>
      tx.codigoVerificacao.updateMany({
        where: {
          id: codigoId,
          usuarioId: userId,
          usadoEm: null,
          expiraEm: { gt: validAfter },
        },
        data: { usadoEm },
      }),

    /** @param {{ userId: string, senhaHash: string }} input */
    setUserPasswordIfMissing: ({ userId, senhaHash }) =>
      tx.usuario.updateMany({
        where: { id: userId, senhaHash: null },
        data: { senhaHash },
      }),

    /** @param {{ userId: string }} input */
    getUserById: ({ userId }) =>
      tx.usuario.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, tenantId: true, role: true, ativo: true },
      }),
  };
}
