import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __tgfwPrisma__: PrismaClient | undefined;
}

const databaseAvailable = Boolean(process.env.DATABASE_URL);

const prisma = globalThis.__tgfwPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__tgfwPrisma__ = prisma;
}

export { prisma, databaseAvailable };
