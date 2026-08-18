'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { ApiError, refreshSession } from '@/lib/api';
export function DownloadButton({ url, filename, label, variant = 'btnSecondary', }: {
    url: string;
    filename: string;
    label: string;
    variant?: 'btnSecondary' | 'btnPrimary' | 'btnGhost';
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function download() {
        setBusy(true);
        setError(null);
        try {
            const { getAccessToken } = await import('@/lib/api');
            const request = async () => fetch(url, {
                headers: { ...(getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}) },
            });
            let res = await request();
            if (res.status === 401 && await refreshSession())
                res = await request();
            if (!res.ok) {
                let message = `Could not prepare the download (${res.status}).`;
                try {
                    const body = await res.json();
                    message = body?.error?.message ?? message;
                }
                catch { }
                throw new ApiError(res.status, 'download_failed', message);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
        }
        finally {
            setBusy(false);
        }
    }
    return (<span>
      <button type="button" className={`btn ${variant}`} onClick={download} disabled={busy}>
        {busy
            ? <Loader2 size={15} aria-hidden="true" className="spin"/>
            : <Download size={15} aria-hidden="true"/>}
        {busy ? 'Preparing...' : label}
      </button>
      {error ? (<span role="alert" className="small" style={{ color: 'var(--absent-fg)', display: 'block', marginTop: '0.25rem' }}>
          {error}
        </span>) : null}
    </span>);
}
