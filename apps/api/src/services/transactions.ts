import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../middleware/errors.js';

export async function transaction<T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Explicit row/advisory locks protect writes at READ COMMITTED. Waiting readers
      // see the winning transaction's committed state on their next statement.
      return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10_000 });
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
      if (!conflict) throw error;
      if (attempt === 2) throw new HttpError(409, 'TRANSACTION_CONFLICT', 'Concurrent change; retry the request with the same key.');
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw new HttpError(409, 'TRANSACTION_CONFLICT', 'Retry the request.');
}
