export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly fields?: Array<{
        path: string;
        message: string;
    }>, readonly details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
export function setAccessToken(token: string | null): void {
    accessToken = token;
}
export function hasAccessToken(): boolean {
    return accessToken !== null;
}
export function getAccessToken(): string | null {
    return accessToken;
}
async function parseError(res: Response): Promise<ApiError> {
    let code = 'error';
    let message = `Request failed (${res.status})`;
    let fields;
    let details;
    try {
        const body = await res.json();
        if (body?.error) {
            code = body.error.code ?? code;
            message = body.error.message ?? message;
            fields = body.error.fields;
            details = body.error.details;
        }
    }
    catch {
    }
    return new ApiError(res.status, code, message, fields, details);
}
export async function refreshSession(): Promise<boolean> {
    refreshInFlight ??= (async () => {
        try {
            const res = await fetch('/api/auth/refresh', { method: 'POST' });
            if (!res.ok) {
                accessToken = null;
                return false;
            }
            const body = await res.json();
            accessToken = body.access_token ?? null;
            return accessToken !== null;
        }
        catch {
            accessToken = null;
            return false;
        }
        finally {
            queueMicrotask(() => {
                refreshInFlight = null;
            });
        }
    })();
    return refreshInFlight;
}
async function send(path: string, init: RequestInit): Promise<Response> {
    return fetch(path, {
        ...init,
        headers: {
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            ...init.headers,
        },
    });
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res = await send(path, init);
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
        if (await refreshSession()) {
            res = await send(path, init);
        }
    }
    if (!res.ok)
        throw await parseError(res);
    if (res.status === 204)
        return undefined as T;
    return res.json() as Promise<T>;
}
export interface SessionUser {
    id: string;
    member_id: string;
    username: string;
    email: string;
    email_verified: boolean;
    profile_locked: boolean;
    offices: string[];
    admin_offices: string[];
    is_admin: boolean;
}
export async function signIn(identifier: string, password: string): Promise<SessionUser> {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok)
        throw await parseError(res);
    const body = await res.json();
    accessToken = body.access_token;
    return body.user as SessionUser;
}
export async function signOut(): Promise<void> {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    }
    finally {
        accessToken = null;
    }
}
export async function fetchMe(): Promise<SessionUser> {
    const body = await api<{
        user: SessionUser;
    }>('/api/auth/me');
    return body.user;
}
