import { PrismaClient } from '@prisma/client';
import env from '../config/env';

// one client per process, it keeps its own connection pool
const prisma = new PrismaClient({
  log: env.isProduction ? ['error'] : ['warn', 'error'],
});

export default prisma;
