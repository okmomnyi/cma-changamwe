import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({
    level: env.LOG_LEVEL,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.password_hash',
            '*.code',
            '*.code_hash',
            '*.token',
            '*.token_hash',
            '*.draft_token',
            'body.password',
            'body.current_password',
            'body.code',
        ],
        censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
});
