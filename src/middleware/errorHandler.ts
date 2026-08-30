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
/**
 * Errors raised by the body parser before any route sees the request.
 *
 * These are the caller's fault, not ours, and returning 500 for them both
 * misleads whoever is debugging and buries a real server fault among noise.
 */
const BODY_ERRORS: Record<string, { status: number; code: string; message: string }> = {
    'entity.parse.failed': {
        status: 400, code: 'malformed_body',
        message: 'That request body is not valid JSON.',
    },
    'entity.too.large': {
        status: 413, code: 'payload_too_large',
        message: 'That request is too large. Photographs upload straight to storage rather than through this endpoint.',
    },
    'encoding.unsupported': {
        status: 415, code: 'unsupported_encoding',
        message: 'That content encoding is not supported.',
    },
    'charset.unsupported': {
        status: 415, code: 'unsupported_charset',
        message: 'That character set is not supported. Send UTF-8.',
    },
    'request.aborted': {
        status: 400, code: 'request_aborted',
        message: 'The request ended before it finished sending.',
    },
    'request.size.invalid': {
        status: 400, code: 'bad_request',
        message: 'The declared content length did not match what arrived.',
    },
};

function bodyError(err: unknown): { status: number; code: string; message: string } | null {
    if (!err || typeof err !== 'object' || !('type' in err))
        return null;
    const type = (err as { type?: unknown }).type;
    return typeof type === 'string' ? (BODY_ERRORS[type] ?? null) : null;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    const body = bodyError(err);
    if (body) {
        res.status(body.status).json({ error: { code: body.code, message: body.message } });
        return;
    }
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
