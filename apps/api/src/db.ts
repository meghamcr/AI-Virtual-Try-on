import { PrismaClient, type Prisma } from "@prisma/client";
export const db = new PrismaClient();
// All personal-data mutations and result publication serialize on this lock.
export async function ownedTransaction<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(Error("Not found"), { status: 404 });
      return fn(tx);
    },
    { timeout: 60000 },
  );
}
export async function garbage(
  tx: Prisma.TransactionClient,
  keys: (string | null | undefined)[],
) {
  for (const key of new Set(keys.filter((k): k is string => !!k)))
    await tx.garbageObject.upsert({
      where: { key },
      create: { key },
      update: {},
    });
}
