'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Sits inside the signed-in shell, so a page that fails keeps the navigation
 * and the reader can move somewhere else without going back to sign-in.
 */
export default function PortalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Portal page failed to render', error);
    }, [error]);

    return (<section className="card" role="alert" style={{ maxWidth: '36rem' }}>
      <div className="cardHeader">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={18} aria-hidden="true"/>
          This page could not be shown
        </h2>
      </div>
      <div className="cardBody">
        <p className="muted">
          The fault is on our side. Nothing you were looking at has been changed, and the rest of
          the portal still works. Try again, and if it keeps happening tell the Secretary what you
          were doing at the time.
        </p>

        {error.digest ? (
          <p className="subtle small" style={{ marginTop: '0.75rem' }}>
            Reference <code className="mono">{error.digest}</code>
          </p>
        ) : null}

        {process.env.NODE_ENV !== 'production' && error.message ? (
          <pre className="mono" style={{
              marginTop: '0.75rem', padding: '0.75rem', overflowX: 'auto',
              background: 'var(--surface-sunken)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--absent-fg)',
          }}>{error.message}</pre>
        ) : null}

        <button type="button" className="btn btnPrimary" onClick={reset} style={{ marginTop: '1.25rem' }}>
          <RefreshCw size={15} aria-hidden="true"/>
          Try again
        </button>
      </div>
    </section>);
}
