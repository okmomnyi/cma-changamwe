'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MailCheck, Send } from 'lucide-react';
import { ApiError } from '@/lib/api';
import styles from '../sign-in/sign-in.module.css';

export default function ForgotPasswordPage() {
    const [identifier, setIdentifier] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch('/api/auth/password-reset/request', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ identifier: identifier.trim() }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new ApiError(res.status, body?.error?.code ?? 'error',
                    body?.error?.message ?? 'That did not work. Please try again.');
            }
            setSent(true);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
        }
        finally {
            setSubmitting(false);
        }
    }

    return (<main id="main" className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true"/>
          <div>
            <p className={styles.brandName}>CMA Changamwe</p>
            <p className="subtle small">Catholic Men Association</p>
          </div>
        </div>

        {sent ? (
          <>
            <h1 className={styles.heading}>Check your email</h1>
            <p className="muted small">
              If that username or email belongs to an account, a link to choose a new password is
              on its way. It lasts one hour and can be used once.
            </p>
            <p className="muted small" style={{ marginTop: 'var(--space-4)' }}>
              Nothing arrived? Look in your spam folder first. If it is not there, the address on
              your account may be an old one, and the Secretary can correct it for you.
            </p>
            <p className={styles.footNote}>
              <MailCheck size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
              <Link href="/sign-in">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Forgotten password</h1>
            <p className="muted small">
              Enter your username or the email address on your account, and we will send you a
              link to set a new password.
            </p>

            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <div className="field">
                <label className="fieldLabel" htmlFor="identifier">Username or email address</label>
                <input id="identifier" className="input" value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username" autoCapitalize="none" spellCheck={false}
                  autoFocus required aria-invalid={error ? true : undefined}/>
              </div>

              <button type="submit" className="btn btnPrimary" disabled={submitting || !identifier.trim()}>
                <Send size={16} aria-hidden="true"/>
                {submitting ? 'Sending...' : 'Send the reset link'}
              </button>
            </form>

            <p className={styles.footNote}>
              Remembered it? <Link href="/sign-in">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>);
}
