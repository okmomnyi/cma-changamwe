'use client';

import { AlertTriangle, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { formatDateTime } from '@/lib/format';
import { EmptyState, ErrorState, LoadingState } from './ui';
import styles from './BackupPanel.module.css';

interface BackupRun {
    object_key: string | null;
    status: 'running' | 'verified' | 'failed' | 'pruned';
    started_at: string;
    finished_at: string | null;
    verified_at: string | null;
    byte_size: string | null;
    row_count: string | null;
    schema_version: string | null;
    duration_ms: number | null;
    error: string | null;
}

interface BackupsResponse {
    configured: boolean;
    reason: string | null;
    retention_days: number;
    min_keep: number;
    verified_in_last_48h: number;
    stale: boolean;
    last_verified: BackupRun | null;
    last_attempt: BackupRun | null;
    recent: BackupRun[];
}

function kb(bytes: string | null): string {
    if (!bytes) return '--';
    const n = Number(bytes);
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} kB`;
}

/**
 * When the association was last provably recoverable: the last backup read back
 * out of storage and checked, never the last one merely attempted.
 */
export function BackupPanel() {
    const { data, error, loading, reload } = useResource<BackupsResponse>('/api/admin/backups');

    if (loading) return <LoadingState label="Checking the backups"/>;
    if (error) return <ErrorState error={error} onRetry={reload}/>;

    const d = data!;
    const last = d.last_verified;

    return (<section className="card" aria-labelledby="backups">
      <div className="cardHeader">
        <h2 id="backups">Backups</h2>
        <span className="subtle small">
          Nightly, kept {d.retention_days} days, never fewer than {d.min_keep}
        </span>
      </div>

      <div className="cardBody">
        {!d.configured ? (
          <p className="noticeWarn" role="alert">
            <AlertTriangle size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
            {d.reason} Until this is set, nothing is being copied off Neon.
          </p>
        ) : d.stale ? (
          <p className="noticeWarn" role="alert">
            <AlertTriangle size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
            No backup has been verified in the last 48 hours. The nightly job may be failing.
            {d.last_attempt?.error ? ` The last attempt said: ${d.last_attempt.error}` : ''}
          </p>
        ) : (
          <p className={styles.good} role="status">
            <ShieldCheck size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
            Last verified backup {last ? formatDateTime(last.verified_at ?? last.started_at) : '--'}.
            It was read back out of storage and checked, not merely written.
          </p>
        )}

        {last ? (
          <dl className={styles.tally}>
            <div><dt>Rows saved</dt><dd>{Number(last.row_count ?? 0).toLocaleString('en-KE')}</dd></div>
            <div><dt>Size</dt><dd>{kb(last.byte_size)}</dd></div>
            <div><dt>Took</dt><dd>{last.duration_ms ? `${(last.duration_ms / 1000).toFixed(1)}s` : '--'}</dd></div>
            <div><dt>Verified in 48h</dt><dd>{d.verified_in_last_48h}</dd></div>
          </dl>
        ) : null}

        {d.recent.length === 0 ? (
          <EmptyState title="No backup has run yet"
            description="The nightly job takes the first one. Until then the only copy of the records is Neon itself."/>
        ) : (
          <div className="tableScroll" style={{ marginTop: 'var(--space-4)' }}>
            <table className="table">
              <caption className="srOnly">Recent backup runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Taken</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="numeric">Rows</th>
                  <th scope="col" className="numeric">Size</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.slice(0, 8).map((r) => (<tr key={r.object_key ?? r.started_at}>
                  <td>{formatDateTime(r.started_at)}</td>
                  <td>
                    <span className={r.status === 'verified' ? styles.pillGood
                        : r.status === 'failed' ? styles.pillBad : styles.pillMuted}>
                      {r.status === 'pruned' ? 'expired' : r.status}
                    </span>
                    {r.error ? (
                      <span className="subtle small" style={{ display: 'block', marginTop: '0.25rem' }}>
                        {r.error}
                      </span>
                    ) : null}
                  </td>
                  <td className="numeric">{r.row_count ? Number(r.row_count).toLocaleString('en-KE') : '--'}</td>
                  <td className="numeric">{kb(r.byte_size)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}

        <p className="muted small" style={{ marginTop: 'var(--space-4)' }}>
          <DatabaseBackup size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
          Backups are written to Cloudflare R2, away from the database, so they survive losing the
          Neon account itself. Neon&apos;s own history covers the smaller accident, where something
          is deleted by mistake and the database has to be wound back a few hours.
        </p>
      </div>
    </section>);
}
