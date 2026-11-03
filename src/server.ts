import app from './app';
import env from './config/env';
import logger from './lib/logger';
import prisma from './lib/prisma';
import redis from './lib/redis';
import { plannerQueue, batchQueue } from './queues';

const server = app.listen(env.port, () => {
  logger.info(`api listening on port ${env.port}`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, closing api`);

  // don't hang forever if something refuses to close
  setTimeout(() => process.exit(1), env.workers.shutdownTimeoutMs).unref();

  server.close(async () => {
    await Promise.allSettled([plannerQueue.close(), batchQueue.close()]);
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
