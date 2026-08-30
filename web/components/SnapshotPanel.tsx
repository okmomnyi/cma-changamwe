'use client';

import { useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { summariseError } from '@/lib/formErrors';
import { formatMonth } from '@/lib/format';
import { completedPeriods } from '@/lib/welfare';
import { EmptyState, ErrorState, LoadingState } from './ui';
import styles from './SnapshotPanel.module.css';

interface SnapshotsResponse {
    period: string;
    snapshots: Array<{ id: string }>;
    by_standing: Record<string, number>;
    by_email_status: Record<string, number>;
    latest_complete_period: string;
}

export function SnapshotPanel() {
    const periods = completedPeriods();
    const [period, setPeriod] = useState(periods[0]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const { data, error: loadError, loading, reload } = useResource<SnapshotsResponse>(
        `/api/admin/matrix/snapshots?period=${period}`,
    );

    const taken = data?.snapshots.length ?? 0;
    const sent = data?.by_email_status.sent ?? 0;
    const pending = data?.by_email_status.pending ?? 0;
    const failed = data?.by_email_status.failed ?? 0;

    async function run(action: () => Promise<string>) {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            setNotice(await action());
            reload();
        }
        catch (err) {
            setError(summariseError(err));
        }
        finally {
            setBusy(false);
        }
    }

    const takeSnapshot = () => run(async () => {
        const result = await api<{
            written: number;
            skipped_existing: number;
        }>('/api/admin/matrix/snapshots', {
            method: 'POST',
            body: JSON.stringify({ period }),
        });
        return result.written > 0
            ? `${formatMonth(`${period}-01`)} closed for ${result.written} members. Their reports go out with the next sending.`
            : `${formatMonth(`${period}-01`)} was already closed for every member. Nothing was changed.`;
    });

    const retryFailed = () => run(async () => {
        const result = await api<{
            requeued: number;
        }>('/api/admin/matrix/snapshots/requeue', {
            method: 'POST',
            body: JSON.stringify({ period }),
        });
        return result.requeued > 0
            ? `${result.requeued} reports queued again. They go out with the next sending.`
            : 'There were no failed reports to retry.';
    });

    return (<section className="card" aria-labelledby="snapshots">
      <div className="cardHeader">
        <h2 id="snapshots">Monthly reports</h2>
        <span className="subtle small">Once a month, then fixed</span>
      </div>

      <div className="cardBody">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className="notice" role="status">{notice}</p> : null}

        <p className="muted small" style={{ marginBottom: 'var(--space-4)' }}>
          Closing a month freezes its scores. That frozen copy is what members receive and what a
          welfare decision rests on, so a month still running cannot be closed.
        </p>

        <div className={styles.controls}>
          <div className="field" style={{ flex: '0 1 14rem' }}>
            <label className="fieldLabel" htmlFor="snapshot-period">Period</label>
            <select id="snapshot-period" className="input" value={period}
              onChange={(e) => { setPeriod(e.target.value); setNotice(null); setError(null); }}>
              {periods.map((p) => (
                <option key={p} value={p}>{formatMonth(`${p}-01`)}</option>
              ))}
            </select>
          </div>

          <button type="button" className="btn btnPrimary" onClick={takeSnapshot} disabled={busy}>
            <Camera size={15} aria-hidden="true"/>
            {busy ? 'Working...' : taken > 0 ? 'Fill any gaps' : 'Take the snapshot'}
          </button>

          {failed > 0 ? (
            <button type="button" className="btn btnSecondary" onClick={retryFailed} disabled={busy}>
              <RotateCcw size={15} aria-hidden="true"/>
              Retry {failed} failed
            </button>
          ) : null}
        </div>

        {loading ? <LoadingState label="Loading the period"/> : null}
        {loadError ? <ErrorState error={loadError} onRetry={reload}/> : null}

        {data && taken === 0 && !loading ? (
          <EmptyState title={`${formatMonth(`${period}-01`)} is not closed yet`}
            description="Closing it puts every member report in the queue to be sent."/>
        ) : null}

        {data && taken > 0 ? (
          <dl className={styles.tally}>
            <div><dt>Snapshots</dt><dd>{taken}</dd></div>
            <div><dt>Reports sent</dt><dd>{sent}</dd></div>
            <div><dt>Waiting</dt><dd>{pending}</dd></div>
            <div className={failed > 0 ? styles.bad : undefined}>
              <dt>Failed</dt><dd>{failed}</dd>
            </div>
          </dl>
        ) : null}

        {failed > 0 ? (
          <p className="noticeWarn" role="status" style={{ marginTop: 'var(--space-4)' }}>
            {failed === 1 ? 'One report' : `${failed} reports`} could not be delivered. A member
            with no account has nowhere to receive one, so give them a printed copy. Anything
            else is worth retrying.
          </p>
        ) : null}
      </div>
    </section>);
}
