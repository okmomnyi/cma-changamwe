'use client';

import { useEffect } from 'react';

/**
 * The last boundary. It replaces the whole document, so it carries its own
 * html and body and cannot rely on globals.css having loaded, nor on the theme
 * bootstrap that lives in the root layout. Everything here is self-contained,
 * which means it follows the device setting and not a stored preference.
 *
 * Reached only when the root layout itself throws, which in practice means the
 * session provider failed before any page rendered.
 */
const SHEET = `
  :root {
    color-scheme: light dark;
    --bg: #f8f6f3; --fg: #1a1815; --muted: #6b645b; --subtle: #8a8279;
    --heading: #12293f; --brand: #17324f; --brand-on: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12161b; --fg: #ece8e1; --muted: #aaa39a; --subtle: #8b847b;
      --heading: #dde7f2; --brand: #2b5a8a; --brand-on: #ffffff;
    }
  }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: 1.5rem; background: var(--bg); color: var(--fg); line-height: 1.55;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .eyebrow {
    margin: 0; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--subtle);
  }
  h1 { margin: 0.5rem 0 0; font-size: 1.625rem; line-height: 1.25; font-weight: 600; color: var(--heading); }
  .lead { margin: 0.75rem 0 0; color: var(--muted); }
  .ref { margin: 1rem 0 0; font-size: 0.8125rem; color: var(--subtle); }
  .ref code { font-family: ui-monospace, Consolas, monospace; }
  button {
    margin-top: 1.5rem; height: 2.25rem; padding: 0 1rem;
    border: 1px solid transparent; border-radius: 6px;
    background: var(--brand); color: var(--brand-on);
    font: inherit; font-weight: 500; cursor: pointer;
  }
  button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
`;

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
        <body>
          <style dangerouslySetInnerHTML={{ __html: SHEET }}/>
          <main id="main" style={{ maxWidth: '30rem' }}>
            <p className="eyebrow">CMA Changamwe</p>

            <h1>The portal could not start</h1>

            <p className="lead">
              This is a fault on our side. Your records are not affected. Reload the page, and if
              it keeps happening tell the Secretary or the Coordinator.
            </p>

            {error.digest ? (
              <p className="ref">Reference <code>{error.digest}</code></p>
            ) : null}

            <button type="button" onClick={reset}>Reload the portal</button>
          </main>
        </body>
      </html>
    );
}
