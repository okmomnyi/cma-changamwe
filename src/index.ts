process.env.TZ ??= 'Africa/Nairobi';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { logger } from './util/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
const app = createApp();
const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, tz: process.env.TZ }, 'CMA Changamwe API listening');
    startScheduler();
});
function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close(async () => {
        try {
            await closePool();
        }
        finally {
            process.exit(0);
        }
    });
    setTimeout(() => {
        logger.error('forced exit after shutdown timeout');
        process.exit(1);
    }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
});
