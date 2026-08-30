'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { summariseError } from '@/lib/formErrors';
import { formatMonth } from '@/lib/format';
import { completedPeriods, type ClaimRow } from '@/lib/welfare';
import styles from './ClaimDecision.module.css';

interface Standing {
    period: string;
    snapshot: { standing: string; total_score: string; attainable_total: string } | null;
    live: { standing: string; total_score: number } | null;
    note: string;
}

export function ClaimDecision({ claim, onDone }: { claim: ClaimRow; onDone: () => void }) {
    const periods = completedPeriods();
    const [open, setOpen] = useState(false);
    const [period, setPeriod] = useState(periods[0]);
    const [standing, setStanding] = useState<Standing | null>(null);
    const [decisionNote, setDecisionNote] = useState('');
    const [override, setOverride] = useState('');
    const [needsOverride, setNeedsOverride] = useState(false);
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadStanding(forPeriod: string) {
        setError(null);
        try {
            setStanding(await api<Standing>(`/api/admin/welfare/claims/${claim.id}/standing?period=${forPeriod}`));
        }
        catch (err) {
            setError(summariseError(err));
        }
    }

    async function openPanel() {
        setOpen(true);
        await loadStanding(period);
    }

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        try {
            await action();
            setOpen(false);
            setNeedsOverride(false);
            setOverride('');
            onDone();
        }
        catch (err) {
            const message = summariseError(err);
            if (message.includes('override_reason'))
                setNeedsOverride(true);
            setError(message);
        }
        finally {
            setBusy(false);
        }
    }

    const decide = (decision: 'approved' | 'rejected') => run(async () => {
        await api(`/api/admin/welfare/claims/${claim.id}/decide`, {
            method: 'POST',
            body: JSON.stringify({
                decision,
                period,
                decision_note: decisionNote.trim() || null,
                override_reason: override.trim() || undefined,
            }),
        });
    });

    const pay = () => run(async () => {
        await api(`/api/admin/welfare/claims/${claim.id}/pay`, {
            method: 'POST',
            body: JSON.stringify({ payment_reference: reference.trim() }),
        });
    });

    const withdraw = () => run(async () => {
        await api(`/api/admin/welfare/claims/${claim.id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: decisionNote.trim() || 'Withdrawn by the officer' }),
        });
    });

    if (claim.status === 'paid' || claim.status === 'rejected' || claim.status === 'cancelled') {
        return <span className="subtle small">Closed</span>;
    }

    if (!open) {
        return (<button type="button" className="btn btnSecondary" onClick={openPanel}>
          {claim.status === 'approved' ? 'Record payment' : 'Decide'}
        </button>);
    }

    return (<div className={styles.panel}>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {claim.status === 'approved' ? (
        <>
          <p className="label">Record the payment</p>
          <div className="field">
            <label className="fieldLabel" htmlFor={`ref-${claim.id}`}>How it was paid</label>
            <input id={`ref-${claim.id}`} className="input" value={reference} required
              placeholder="M-Pesa code, cheque number, or cash receipt"
              onChange={(e) => setReference(e.target.value)}/>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btnGhost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btnPrimary" onClick={pay} disabled={busy || !reference.trim()}>
              {busy ? 'Recording...' : 'Mark as paid'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="label">Decide this claim</p>

          <div className="field">
            <label className="fieldLabel" htmlFor={`period-${claim.id}`}>Standing for</label>
            <select id={`period-${claim.id}`} className="input" value={period}
              onChange={(e) => { setPeriod(e.target.value); void loadStanding(e.target.value); }}>
              {periods.map((p) => <option key={p} value={p}>{formatMonth(`${p}-01`)}</option>)}
            </select>
          </div>

          {standing ? (
            <div className={standing.snapshot?.standing === 'in_good_standing' ? styles.good : styles.warn}>
              {standing.snapshot ? (<>
                <strong>{standing.snapshot.standing.replace(/_/g, ' ')}</strong>
                {' '}on {Number(standing.snapshot.total_score).toFixed(2)} of{' '}
                {Number(standing.snapshot.attainable_total).toFixed(0)}.
              </>) : (
                <>No snapshot for {formatMonth(`${period}-01`)}. Take it from the Matrix page, or record a reason below.</>
              )}
            </div>
          ) : null}

          <div className="field">
            <label className="fieldLabel" htmlFor={`note-${claim.id}`}>Note</label>
            <input id={`note-${claim.id}`} className="input" value={decisionNote} maxLength={500}
              placeholder="What the committee decided"
              onChange={(e) => setDecisionNote(e.target.value)}/>
          </div>

          {needsOverride ? (
            <div className="field">
              <label className="fieldLabel" htmlFor={`override-${claim.id}`}>Committee exception</label>
              <input id={`override-${claim.id}`} className="input" value={override} required
                placeholder="e.g. committee of 4 August agreed to pay despite the standing"
                onChange={(e) => setOverride(e.target.value)} aria-describedby={`override-hint-${claim.id}`}/>
              <p id={`override-hint-${claim.id}`} className="subtle small">
                Approving against the Matrix needs a reason. It is kept in the audit log with the
                standing that was actually on record.
              </p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className="btn btnGhost" onClick={() => setOpen(false)} disabled={busy}>Close</button>
            <button type="button" className="btn btnGhost" onClick={withdraw} disabled={busy}>Withdraw</button>
            <button type="button" className="btn btnSecondary" onClick={() => decide('rejected')} disabled={busy}>Reject</button>
            <button type="button" className="btn btnPrimary" onClick={() => decide('approved')}
              disabled={busy || (needsOverride && override.trim().length < 4)}>
              {busy ? 'Saving...' : 'Approve'}
            </button>
          </div>
        </>
      )}
    </div>);
}
