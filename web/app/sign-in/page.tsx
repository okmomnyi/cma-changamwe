'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError, type SessionUser } from '@/lib/api';
import styles from './sign-in.module.css';

export default function SignInPage() {
    const { user, loading, signIn, verifyLoginOtp } = useAuth();
    const router = useRouter();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [challenge, setChallenge] = useState<{ token: string; hint: string } | null>(null);
    const [code, setCode] = useState('');

    useEffect(() => {
        if (!loading && user)
            router.replace('/portal');
    }, [user, loading, router]);

    function go(signedIn: SessionUser) {
        router.replace(signedIn.is_admin ? '/admin' : '/portal');
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const result = await signIn(identifier.trim(), password);
            if (result.status === 'otp_required') {
                setChallenge({ token: result.challengeToken, hint: result.emailHint });
                setSubmitting(false);
                return;
            }
            go(result.user);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
            setSubmitting(false);
        }
    }

    async function handleVerify(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const signedIn = await verifyLoginOtp(challenge!.token, code.trim());
            go(signedIn);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
            setSubmitting(false);
        }
    }

    function restart() {
        setChallenge(null);
        setCode('');
        setPassword('');
        setError(null);
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

        {challenge ? (
          <>
            <h1 className={styles.heading}>Enter your sign-in code</h1>
            <p className="muted small">
              We sent a 6-digit code to {challenge.hint}. It expires in 10 minutes.
            </p>

            <form onSubmit={handleVerify} className={styles.form} noValidate>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <div className="field">
                <label className="fieldLabel" htmlFor="code">Sign-in code</label>
                <input id="code" className={`input ${styles.codeInput}`} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  autoFocus required aria-invalid={error ? true : undefined}/>
              </div>

              <button type="submit" className="btn btnPrimary" disabled={submitting || code.length !== 6}>
                <ShieldCheck size={16} aria-hidden="true"/>
                {submitting ? 'Verifying...' : 'Verify and sign in'}
              </button>
              <button type="button" className="btn btnGhost" onClick={restart} disabled={submitting}>
                Use a different account
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Sign in</h1>
            <p className="muted small">Use the username and password you set when you registered.</p>

            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <div className="field">
                <label className="fieldLabel" htmlFor="identifier">Username or email address</label>
                <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required aria-invalid={error ? true : undefined}/>
              </div>

              <div className="field">
                <label className="fieldLabel" htmlFor="password">Password</label>
                <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required aria-invalid={error ? true : undefined}/>
              </div>

              <button type="submit" className="btn btnPrimary" disabled={submitting || !identifier || !password}>
                <LogIn size={16} aria-hidden="true"/>
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p className={styles.footNote}>
              New member? <Link href="/register">Register here</Link>. You can save your progress and
              come back to it.
            </p>
          </>
        )}
      </div>
    </main>);
}
