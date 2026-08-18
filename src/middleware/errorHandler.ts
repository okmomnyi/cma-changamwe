import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { isProduction } from '../config/env.js';
export function notFoundHandler(req: Request, res: Response) {
    res.status(404).json({
        error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
    });
}
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ZodError) {
        res.status(400).json({
            error: {
                code: 'validation_failed',
                message: 'Some fields need attention.',
                fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            },
        });
        return;
    }
    if (err instanceof AppError) {
        if (err.status >= 500)
            logger.error({ err, path: req.path }, 'application error');
        res.status(err.status).json({
            error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
        });
        return;
    }
    logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
    res.status(500).json({
        error: {
            code: 'internal_error',
            message: 'Something went wrong on our side. Please try again.',
            ...(isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
        },
    });
}
