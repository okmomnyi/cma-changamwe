'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { ApiError } from '@/lib/api';
import styles from '../sign-in/sign-in.module.css';

function ResetPasswordForm() {
    const params = useSearchParams();
    const router = useRouter();
    const token = params.get('token') ?? '';

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    const tooShort = password.length > 0 && password.length < 10;
    const mismatch = confirm.length > 0 && confirm !== password;
    const ready = password.length >= 10 && confirm === password && !submitting;

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch('/api/auth/password-reset/confirm', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new ApiError(res.status, body?.error?.code ?? 'error',
                    body?.error?.message ?? 'That did not work. Please ask for a new link.');
            }
            setDone(true);
            setTimeout(() => router.replace('/sign-in'), 2500);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
        }
        finally {
            setSubmitting(false);
        }
    }

    if (!token) {
        return (
          <>
            <h1 className={styles.heading}>That link is incomplete</h1>
            <p className="muted small">
              The reset link did not carry its code. Copy the whole address from the email, or ask
              for a fresh link.
            </p>
            <p className={styles.footNote}>
              <Link href="/forgot-password">Ask for a new link</Link>
            </p>
          </>
        );
    }

    if (done) {
        return (
          <>
            <h1 className={styles.heading}>Your password is set</h1>
            <p className="muted small">
              Every device that was signed in has been signed out. Taking you to the sign-in page.
            </p>
            <p className={styles.footNote}>
              <Link href="/sign-in">Sign in now</Link>
            </p>
          </>
        );
    }

    return (
      <>
        <h1 className={styles.heading}>Choose a new password</h1>
        <p className="muted small">
          Use at least 10 characters. A short phrase you will remember beats a short word you will
          not.
        </p>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <div className="field">
            <label className="fieldLabel" htmlFor="password">New password</label>
            <input id="password" className="input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" autoFocus required
              aria-invalid={tooShort ? true : undefined}
              aria-describedby={tooShort ? 'password-hint' : undefined}/>
            {tooShort ? (
              <p id="password-hint" className="subtle small" role="alert">
                That is {password.length} characters. Use at least 10.
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="fieldLabel" htmlFor="confirm">Type it again</label>
            <input id="confirm" className="input" type="password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" required
              aria-invalid={mismatch ? true : undefined}
              aria-describedby={mismatch ? 'confirm-hint' : undefined}/>
            {mismatch ? (
              <p id="confirm-hint" className="subtle small" role="alert">
                The two do not match yet.
              </p>
            ) : null}
          </div>

          <button type="submit" className="btn btnPrimary" disabled={!ready}>
            <KeyRound size={16} aria-hidden="true"/>
            {submitting ? 'Setting...' : 'Set my password'}
          </button>
        </form>

        <p className={styles.footNote}>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </>
    );
}

export default function ResetPasswordPage() {
    return (<main id="main" className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true"/>
          <div>
            <p className={styles.brandName}>CMA Changamwe</p>
            <p className="subtle small">Catholic Men Association</p>
          </div>
        </div>
        <Suspense fallback={<p className="muted small">Loading...</p>}>
          <ResetPasswordForm/>
        </Suspense>
      </div>
    </main>);
}
