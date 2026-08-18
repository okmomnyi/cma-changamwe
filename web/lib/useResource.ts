'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
export interface Resource<T> {
    data: T | null;
    error: ApiError | null;
    loading: boolean;
    reload: () => void;
}
export function useResource<T>(path: string | null): Resource<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(path !== null);
    const [nonce, setNonce] = useState(0);
    const reload = useCallback(() => setNonce((n) => n + 1), []);
    useEffect(() => {
        if (!path) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        api<T>(path)
            .then((result) => {
            if (!cancelled)
                setData(result);
        })
            .catch((err: unknown) => {
            if (!cancelled) {
                setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'Could not reach the server.'));
            }
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [path, nonce]);
    return { data, error, loading, reload };
}
