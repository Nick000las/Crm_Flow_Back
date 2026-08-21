import { getAdminClient } from '#core/db/tenantClient.js';

/** @typedef {import('@prisma/client').Prisma.TransactionClient} TransactionClient */

export class LoginRepository {
  /**
   * O login ainda não possui contexto de tenant, portanto esta consulta é uma
   * das operações administrativas permitidas antes da criação do JWT.
   *
   * @param {{ email: string }} input
   */
  static async getUserEmailAndPassword({ email }) {
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
  static async runInTransaction(operation) {
    return getAdminClient().$transaction((tx) => operation(createTransactionRepository(tx)));
  }

  /** @param {{ usuarioId: string }} input */
  static async getLatestActivationCode({ usuarioId }) {
    return getAdminClient().codigoAtivacaoSenha.findFirst({
      where: { usuarioId },
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
   * @param {{ activationCodeId: string, validAfter: Date, maxAttempts: number, incrementBy: number }} input
   */
  static async incrementActivationAttempts({
    activationCodeId,
    validAfter,
    maxAttempts,
    incrementBy,
  }) {
    return getAdminClient().codigoAtivacaoSenha.updateMany({
      where: {
        id: activationCodeId,
        usadoEm: null,
        expiraEm: { gt: validAfter },
        tentativas: { lt: maxAttempts },
      },
      data: { tentativas: { increment: incrementBy } },
    });
  }

  /** @param {{ userId: string }} input */
  static async getUserById({ userId }) {
    return getAdminClient().usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        ativo: true,
      },
    });
  }
}

/** @param {TransactionClient} tx */
function createTransactionRepository(tx) {
  return {
    /** @param {{ usuarioId: string, usadoEm: Date }} input */
    invalidateUnusedActivationCodes: ({ usuarioId, usadoEm }) =>
      tx.codigoAtivacaoSenha.updateMany({
        where: { usuarioId, usadoEm: null },
        data: { usadoEm },
      }),

    /**
     * @param {{ usuarioId: string, tenantId: string, codigoHash: string, expiraEm: Date }} input
     */
    createActivationCode: ({ usuarioId, tenantId, codigoHash, expiraEm }) =>
      tx.codigoAtivacaoSenha.create({
        data: { usuarioId, tenantId, codigoHash, expiraEm },
        select: { id: true },
      }),

    /**
     * @param {{ userId: string, activationCodeId: string, usadoEm: Date, validAfter: Date }} input
     */
    consumeActivationCode: ({ userId, activationCodeId, usadoEm, validAfter }) =>
      tx.codigoAtivacaoSenha.updateMany({
        where: {
          id: activationCodeId,
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
