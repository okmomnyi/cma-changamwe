'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import styles from './EmailChange.module.css';
import { summariseError } from '@/lib/formErrors';

export function PasswordChange() {
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const tooShort = next.length > 0 && next.length < 10;
    const mismatch = confirm.length > 0 && confirm !== next;
    const ready = current.length > 0 && next.length >= 10 && confirm === next && !busy;

    function close() {
        setOpen(false);
        setCurrent('');
        setNext('');
        setConfirm('');
        setError(null);
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api('/api/me/password', {
                method: 'POST',
                body: JSON.stringify({ current_password: current, new_password: next }),
            });
            setNotice('Your password has been changed. Any other device that was signed in has been signed out.');
            setOpen(false);
            setCurrent('');
            setNext('');
            setConfirm('');
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }

    if (!open) {
        return (<div className={styles.row}>
        <div>
          <p className="label">Password</p>
          <p className="muted small">
            {notice ?? 'Changed by you, whenever you like. Forgotten it is handled from the sign-in page.'}
          </p>
        </div>
        <button type="button" className="btn btnSecondary" onClick={() => { setNotice(null); setOpen(true); }}>
          <KeyRound size={15} aria-hidden="true"/>
          Change password
        </button>
      </div>);
    }

    return (<div className={styles.panel}>
      <p className="label">Change your password</p>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <form onSubmit={submit} className={styles.form} noValidate>
        <p className="muted small">
          Use at least 10 characters. Every other device you are signed in on will be signed out.
        </p>

        <div className="field">
          <label className="fieldLabel" htmlFor="pw-current">Your current password</label>
          <input id="pw-current" className="input" type="password" value={current} required
            autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)}/>
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="pw-next">New password</label>
          <input id="pw-next" className="input" type="password" value={next} required
            autoComplete="new-password" onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort ? true : undefined}
            aria-describedby={tooShort ? 'pw-next-hint' : undefined}/>
          {tooShort ? (
            <p id="pw-next-hint" className="subtle small" role="alert">
              That is {next.length} characters. Use at least 10.
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="fieldLabel" htmlFor="pw-confirm">Type it again</label>
          <input id="pw-confirm" className="input" type="password" value={confirm} required
            autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch ? true : undefined}
            aria-describedby={mismatch ? 'pw-confirm-hint' : undefined}/>
          {mismatch ? (
            <p id="pw-confirm-hint" className="subtle small" role="alert">
              The two do not match yet.
            </p>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className="btn btnGhost" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btnPrimary" disabled={!ready}>
            {busy ? 'Changing...' : 'Change password'}
          </button>
        </div>
      </form>
    </div>);
}
