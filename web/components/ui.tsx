'use client';

import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import styles from './ui.module.css';
export function PageHeader({ title, description, actions, }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
}) {
    return (<header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>);
}
export function LoadingState({ label = 'Loading' }: {
    label?: string;
}) {
    return (<div className={styles.state} role="status" aria-live="polite">
      <Loader2 className={styles.spinner} size={20} aria-hidden="true"/>
      <p className="muted">{label}...</p>
    </div>);
}
export function EmptyState({ title, description }: {
    title: string;
    description?: string;
}) {
    return (<div className={styles.state}>
      <Inbox size={22} className="subtle" aria-hidden="true"/>
      <p className={styles.stateTitle}>{title}</p>
      {description ? <p className="muted small">{description}</p> : null}
    </div>);
}
export function ErrorState({ error, onRetry }: {
    error: ApiError;
    onRetry?: () => void;
}) {
    return (<div className={styles.state} role="alert">
      <AlertTriangle size={22} className={styles.errorIcon} aria-hidden="true"/>
      <p className={styles.stateTitle}>{error.message}</p>
      {error.status ? <p className="subtle small">Error {error.status} ({error.code})</p> : null}
      {onRetry ? (<button type="button" className="btn btnSecondary" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true"/>
          Try again
        </button>) : null}
    </div>);
}
const STATUS_CLASS: Record<string, string> = {
    present: 'pillPresent',
    apology: 'pillApology',
    absent: 'pillAbsent',
};
export function StatusPill({ status }: {
    status: string;
}) {
    return <span className={`pill ${STATUS_CLASS[status] ?? 'pillNeutral'}`}>{status}</span>;
}
export function Pill({ tone = 'neutral', children }: {
    tone?: 'neutral' | 'navy' | 'accent';
    children: React.ReactNode;
}) {
    const cls = tone === 'navy' ? 'pillNavy' : tone === 'accent' ? 'pillAccent' : 'pillNeutral';
    return <span className={`pill ${cls}`}>{children}</span>;
}
export function Detail({ label, children }: {
    label: string;
    children: React.ReactNode;
}) {
    return (<div className={styles.detail}>
      <dt className="label">{label}</dt>
      <dd className={styles.detailValue}>{children ?? '--'}</dd>
    </div>);
}
export function DetailGrid({ children }: {
    children: React.ReactNode;
}) {
    return <dl className={styles.detailGrid}>{children}</dl>;
}
export function Stat({ label, value, hint }: {
    label: string;
    value: React.ReactNode;
    hint?: string;
}) {
    return (<div className={`card ${styles.stat}`}>
      <p className="label">{label}</p>
      <p className={styles.statValue}>{value}</p>
      {hint ? <p className="subtle small">{hint}</p> : null}
    </div>);
}
export function StatGrid({ children }: {
    children: React.ReactNode;
}) {
    return <div className={styles.statGrid}>{children}</div>;
}
export function DemoNotice() {
    return (<p className={styles.demoNotice}>
      <AlertTriangle size={14} aria-hidden="true"/>
      <span>
        This installation contains <strong>demo records</strong> for testing. Members whose ID
        begins with <code>DEMO-</code> are invented, and so are their attendance and contributions.
      </span>
    </p>);
}
