import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from './config/env.js';
import { logger } from './util/logger.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { signupRouter } from './routes/signup.js';
import { adminRouter } from './routes/admin.js';
import { exportsRouter } from './routes/exports.js';
import { photosRouter } from './routes/photos.js';
import { jobsRouter } from './routes/jobs.js';
import { verifyRouter } from './routes/verify.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
export function createApp() {
    const app = express();
    if (env.TRUST_PROXY)
        app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(helmet({
        contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
        hsts: env.SECURE_COOKIES ? { maxAge: 31536000, includeSubDomains: true } : false,
        referrerPolicy: { policy: 'no-referrer' },
    }));
    app.use(pinoHttp({
        logger,
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers['x-request-id'];
            const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
        },
        autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' || req.url === '/api/ready' },
    }));
    app.use(express.json({ limit: '256kb' }));
    app.use(cookieParser());
    app.use('/api', healthRouter);
    // Public: anyone holding a document can check it, with no account.
    app.use('/api/verify', verifyRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/signup', signupRouter);
    app.use('/api/me', meRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api/jobs', jobsRouter);
    app.use('/api/exports', exportsRouter);
    app.use('/api', photosRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
