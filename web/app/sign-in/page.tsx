'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import styles from './sign-in.module.css';
export default function SignInPage() {
    const { user, loading, signIn } = useAuth();
    const router = useRouter();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        if (!loading && user)
            router.replace('/portal');
    }, [user, loading, router]);
    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const signedIn = await signIn(identifier.trim(), password);
            router.replace(signedIn.is_admin ? '/admin' : '/portal');
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
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
      </div>
    </main>);
}
