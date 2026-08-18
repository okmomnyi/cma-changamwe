import rateLimit from 'express-rate-limit';
import { tooManyRequests } from '../util/errors.js';
import { isTest } from '../config/env.js';
function ipKey(ip: string): string {
    if (!ip.includes(':'))
        return ip;
    const groups = ip.split(':');
    return `${groups.slice(0, 4).join(':')}::/64`;
}
function limiter(opts: {
    windowMs: number;
    max: number;
    message: string;
    byUser?: boolean;
}) {
    return rateLimit({
        windowMs: opts.windowMs,
        limit: opts.max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: () => isTest,
        keyGenerator: (req) => {
            const ip = ipKey(req.ip ?? '');
            if (!opts.byUser)
                return ip;
            const body = req.body as Record<string, unknown> | undefined;
            const id = typeof body?.identifier === 'string' ? body.identifier.toLowerCase() : '';
            const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';
            return `${ip}|${id || email}`;
        },
        handler: (_req, _res, next) => next(tooManyRequests(opts.message)),
    });
}
export const loginLimiter = limiter({
    windowMs: 15 * 60000,
    max: 10,
    message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
    byUser: true,
});
export const otpSendLimiter = limiter({
    windowMs: 60 * 60000,
    max: 5,
    message: 'Too many verification codes requested. Please wait an hour.',
    byUser: true,
});
export const otpVerifyLimiter = limiter({
    windowMs: 15 * 60000,
    max: 10,
    message: 'Too many verification attempts. Please request a new code.',
    byUser: true,
});
export const passwordResetLimiter = limiter({
    windowMs: 60 * 60000,
    max: 5,
    message: 'Too many password reset requests. Please wait an hour.',
    byUser: true,
});
export const reportDownloadLimiter = limiter({
    windowMs: 60 * 60000,
    max: 30,
    message: 'Too many report downloads. Please wait a while.',
});
