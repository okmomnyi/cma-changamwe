'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches anything a page throws while rendering.
 *
 * Without this the reader gets a blank screen. The digest is the only handle
 * anyone has on a production error, so it is shown rather than hidden, and the
 * full message appears only outside production.
 */
export default function RouteError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Page failed to render', error);
    }, [error]);

    return (<main id="main" style={{ maxWidth: '34rem', margin: '0 auto', padding: '5rem 1.5rem' }}>
      <p className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <AlertTriangle size={14} aria-hidden="true"/>
        Something broke
      </p>

      <h1 style={{ marginTop: '0.5rem' }}>This page could not be shown</h1>

      <p className="muted" style={{ marginTop: '0.75rem' }}>
        The fault is on our side, not yours. Nothing you were looking at has been changed. Try
        again, and if it keeps happening tell the Secretary what you were doing at the time.
      </p>

      {error.digest ? (
        <p className="subtle small" style={{ marginTop: '1rem' }}>
          Reference <code className="mono">{error.digest}</code>. Quoting it helps whoever looks
          into this.
        </p>
      ) : null}

      {process.env.NODE_ENV !== 'production' && error.message ? (
        <pre className="mono" style={{
            marginTop: '1rem', padding: '0.75rem', overflowX: 'auto',
            background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--absent-fg)',
        }}>{error.message}</pre>
      ) : null}

      <div className="row" style={{ marginTop: '1.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btnPrimary" onClick={reset}>
          <RefreshCw size={15} aria-hidden="true"/>
          Try again
        </button>
        <Link className="btn btnSecondary" href="/portal">Back to the portal</Link>
      </div>
    </main>);
}
