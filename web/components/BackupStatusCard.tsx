'use client';

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { formatDateTime } from '@/lib/format';
import styles from './BackupStatusCard.module.css';

interface BackupRun {
    object_key: string | null;
    status: 'running' | 'verified' | 'failed' | 'pruned';
    started_at: string;
    error: string | null;
}

interface BackupsResponse {
    configured: boolean;
    stale: boolean;
    last_verified: BackupRun | null;
    recent: BackupRun[];
}

/** Whether the records are safe, and nothing more. */
export function BackupStatusCard() {
    const { data, error, loading } = useResource<BackupsResponse>('/api/admin/backups');

    // A card this small says nothing while it is loading, and nothing if it
    // cannot load. It must never be the reason a page looks broken.
    if (loading || error || !data) return null;

    const recent = data.recent.filter((r) => r.status !== 'running').slice(0, 2);
    const failed = recent.filter((r) => r.status === 'failed');
    const bad = !data.configured || data.stale || failed.length > 0;

    return (<section className={`card ${styles.card}`} aria-labelledby="backups">
      <div className={styles.head}>
        {bad
          ? <AlertTriangle size={17} className={styles.iconBad} aria-hidden="true"/>
          : <ShieldCheck size={17} className={styles.iconGood} aria-hidden="true"/>}
        <h2 id="backups" className={styles.title}>Backups</h2>
        <span className={bad ? styles.pillBad : styles.pillGood}>
          {!data.configured ? 'Off' : data.stale ? 'Overdue' : failed.length > 0 ? 'Attention' : 'Active'}
        </span>
      </div>

      {!data.configured ? (
        <p className={styles.alert} role="alert">
          Backups are not switched on. Nothing is being saved outside the system.
        </p>
      ) : data.stale ? (
        <p className={styles.alert} role="alert">
          No backup has succeeded in the last two days. Tell whoever looks after the system.
        </p>
      ) : failed.length > 0 ? (
        <p className={styles.alert} role="alert">
          The last backup did not finish. The one before it is still safe, but this needs looking at.
        </p>
      ) : (
        <p className={styles.line}>
          Last saved {data.last_verified ? formatDateTime(data.last_verified.started_at) : '--'}.
        </p>
      )}

      {recent.length > 0 ? (
        <ul className={styles.runs}>
          {recent.map((r) => (
            <li key={r.object_key ?? r.started_at}>
              <span className={r.status === 'failed' ? styles.dotBad : styles.dotGood} aria-hidden="true"/>
              <span className={styles.when}>{formatDateTime(r.started_at)}</span>
              <span className={styles.result}>{r.status === 'failed' ? 'failed' : 'saved'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>);
}
