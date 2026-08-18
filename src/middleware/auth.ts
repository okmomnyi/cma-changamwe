import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth/tokens.js';
import { loadPrincipal, type Principal } from '../auth/authz.js';
import { forbidden, unauthorized } from '../util/errors.js';
declare global {
    namespace Express {
        interface Request {
            principal?: Principal;
        }
    }
}
function bearerFrom(req: Request): string | null {
    const header = req.get('authorization');
    if (!header)
        return null;
    const [scheme, value] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !value)
        return null;
    return value.trim();
}
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
    try {
        const token = bearerFrom(req);
        if (!token)
            throw unauthorized();
        let claims;
        try {
            claims = await verifyAccessToken(token);
        }
        catch {
            throw unauthorized('Session expired or invalid');
        }
        const principal = await loadPrincipal(claims.sub);
        if (!principal)
            throw unauthorized('Session expired or invalid');
        req.principal = principal;
        next();
    }
    catch (err) {
        next(err);
    }
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
    if (!req.principal)
        return next(unauthorized());
    if (!req.principal.isAdmin) {
        return next(forbidden('This action is restricted to the Coordinator and Treasurer.'));
    }
    next();
}
export function principalOf(req: Request): Principal {
    if (!req.principal)
        throw unauthorized();
    return req.principal;
}
