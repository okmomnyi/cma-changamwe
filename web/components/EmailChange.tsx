'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import styles from './EmailChange.module.css';
import { summariseError } from '@/lib/formErrors';
export function EmailChange({ currentEmail }: {
    currentEmail: string;
}) {
    const { refresh } = useAuth();
    const [open, setOpen] = useState(false);
    const [stage, setStage] = useState<'request' | 'confirm' | 'done'>('request');
    const [newEmail, setNewEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        try {
            await action();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }
    const request = (e: React.FormEvent) => {
        e.preventDefault();
        void run(async () => {
            await api('/api/me/email/change-request', {
                method: 'POST',
                body: JSON.stringify({ new_email: newEmail.trim(), current_password: password }),
            });
            setPassword('');
            setStage('confirm');
            setNotice(`If that address can be used, a code is on its way to ${newEmail.trim()}. Your current address has been notified.`);
        });
    };
    const confirm = (e: React.FormEvent) => {
        e.preventDefault();
        void run(async () => {
            await api('/api/me/email/confirm', {
                method: 'POST',
                body: JSON.stringify({ code: code.trim() }),
            });
            await refresh();
            setStage('done');
            setNotice('Your email address has been changed.');
        });
    };
    if (!open) {
        return (<div className={styles.row}>
        <div>
          <p className="label">Email address</p>
          <p>{currentEmail}</p>
        </div>
        <button type="button" className="btn btnSecondary" onClick={() => setOpen(true)}>
          <Mail size={15} aria-hidden="true"/>
          Change email
        </button>
      </div>);
    }
    return (<div className={styles.panel}>
      <p className="label">Change your email address</p>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {stage === 'request' ? (<form onSubmit={request} className={styles.form} noValidate>
          <p className="muted small">
            You will need your current password, and a code sent to the new address. Your current
            address is notified either way.
          </p>
          <div className="field">
            <label className="fieldLabel" htmlFor="new-email">New email address</label>
            <input id="new-email" className="input" type="email" value={newEmail} required autoComplete="email" spellCheck={false} onChange={(e) => setNewEmail(e.target.value)}/>
          </div>
          <div className="field">
            <label className="fieldLabel" htmlFor="current-password">Your current password</label>
            <input id="current-password" className="input" type="password" value={password} required autoComplete="current-password" onChange={(e) => setPassword(e.target.value)}/>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btnGhost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btnPrimary" disabled={busy || !newEmail.trim() || !password}>
              {busy ? 'Sending...' : 'Send code'}
            </button>
          </div>
        </form>) : null}

      {stage === 'confirm' ? (<form onSubmit={confirm} className={styles.form} noValidate>
          <div className="field">
            <label className="fieldLabel" htmlFor="email-code">Code sent to the new address</label>
            <input id="email-code" className={`input ${styles.code}`} value={code} required inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}/>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btnGhost" onClick={() => setStage('request')} disabled={busy}>
              Back
            </button>
            <button type="submit" className="btn btnPrimary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking...' : 'Confirm change'}
            </button>
          </div>
        </form>) : null}

      {stage === 'done' ? (<button type="button" className="btn btnSecondary" style={{ marginTop: 'var(--space-4)' }} onClick={() => { setOpen(false); setStage('request'); setNotice(null); setNewEmail(''); setCode(''); }}>
          Close
        </button>) : null}
    </div>);
}
