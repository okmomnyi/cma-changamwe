'use client';

import { useEffect } from 'react';

/**
 * The last boundary. It replaces the whole document, so it carries its own
 * html and body and cannot rely on globals.css having loaded. Everything here
 * is inline for that reason.
 *
 * Reached only when the root layout itself throws, which in practice means the
 * session provider failed before any page rendered.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('The application failed to start', error);
    }, [error]);

    return (
      <html lang="en">
        <body style={{
            margin: 0,
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            padding: '1.5rem',
            background: '#f8f6f3',
            color: '#1a1815',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            lineHeight: 1.55,
        }}>
          <main id="main" style={{ maxWidth: '30rem' }}>
            <p style={{
                margin: 0, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: '#8a8279',
            }}>CMA Changamwe</p>

            <h1 style={{
                margin: '0.5rem 0 0', fontSize: '1.625rem', lineHeight: 1.25,
                fontWeight: 600, color: '#12293f',
            }}>The portal could not start</h1>

            <p style={{ margin: '0.75rem 0 0', color: '#6b645b' }}>
              This is a fault on our side. Your records are not affected. Reload the page, and if
              it keeps happening tell the Secretary or the Coordinator.
            </p>

            {error.digest ? (
              <p style={{ margin: '1rem 0 0', fontSize: '0.8125rem', color: '#8a8279' }}>
                Reference <code style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{error.digest}</code>
              </p>
            ) : null}

            <button type="button" onClick={reset} style={{
                marginTop: '1.5rem', height: '2.25rem', padding: '0 1rem',
                border: '1px solid transparent', borderRadius: '6px',
                background: '#17324f', color: '#ffffff',
                font: 'inherit', fontWeight: 500, cursor: 'pointer',
            }}>Reload the portal</button>
          </main>
        </body>
      </html>
    );
}
