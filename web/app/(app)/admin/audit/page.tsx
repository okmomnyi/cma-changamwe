'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDateTime, titleCase } from '@/lib/format';
import { auditHeadline, describeAudit, type AuditRow } from '@/lib/audit';
import styles from './audit.module.css';

interface AuditResponse {
    entries: AuditRow[];
    total: number;
    offset: number;
}

const ENTITY_TYPES = ['member', 'attendance', 'contribution', 'office', 'user', 'event', 'welfare_claim'] as const;
const PAGE_SIZE = 50;

export default function AuditPage() {
    const [entity, setEntity] = useState('');
    const [offset, setOffset] = useState(0);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (entity) params.set('entity_type', entity);
    const { data, error, loading, reload } = useResource<AuditResponse>(`/api/admin/audit-log?${params}`);

    return (<>
      <PageHeader title="Audit log" description="Every change to a member record, attendance entry, contribution or office term, with who made it and when."/>

      <p className="card cardTight row" style={{ marginBottom: 'var(--space-5)' }}>
        <Lock size={16} aria-hidden="true" className="subtle"/>
        <span className="small muted">
          Entries are only ever added. Nothing shown here can be edited or erased, by anyone.
        </span>
      </p>

      <div className="card cardTight" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="field" style={{ maxWidth: '18rem' }}>
          <label className="fieldLabel" htmlFor="entity-filter">Filter by record type</label>
          <select id="entity-filter" className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }}>
            <option value="">All record types</option>
            {ENTITY_TYPES.map((t) => (<option key={t} value={t}>{titleCase(t)}</option>))}
          </select>
        </div>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Entries</h2>
          {data ? <span className="subtle small">{data.total.toLocaleString('en-KE')} recorded</span> : null}
        </div>

        {loading ? <LoadingState label="Loading the audit log"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.entries.length === 0 ? (<EmptyState title="No entries of that type" description="Try another record type."/>) : null}

        {data && data.entries.length > 0 ? (<>
            <ul className={styles.entries}>
              {data.entries.map((row) => {
                  const { summary, details } = describeAudit(row);
                  const headline = auditHeadline(row);
                  return (<li key={row.id} className={styles.entry}>
                    <div className={styles.meta}>
                      <time className={styles.when} dateTime={row.changed_at}>
                        {formatDateTime(row.changed_at)}
                      </time>
                      <span className={styles.who}>
                        {row.changed_by_name ?? 'System'}
                        {row.changed_by_username ? (
                          <span className={styles.username}>{row.changed_by_username}</span>
                        ) : null}
                      </span>
                    </div>

                    <div className={styles.body}>
                      <p className={styles.summary}>
                        <Pill>{titleCase(row.entity_type)}</Pill>
                        <span className={styles.action}>{summary}</span>
                        {headline ? <span className={styles.subject}>{headline}</span> : null}
                      </p>

                      {details.length > 0 ? (
                        <dl className={styles.details}>
                          {details.slice(0, 8).map((d, i) => (
                            <div key={`${d.label}-${i}`} className={styles.detail}>
                              <dt>{d.label}</dt>
                              <dd>
                                {d.from !== undefined && d.from !== d.to ? (<>
                                  <span className={styles.from}>{d.from}</span>
                                  <span className={styles.arrow} aria-label="changed to">to</span>
                                </>) : null}
                                <span className={styles.to}>{d.to}</span>
                              </dd>
                            </div>
                          ))}
                          {details.length > 8 ? (
                            <div className={styles.detail}>
                              <dt/>
                              <dd className="subtle">and {details.length - 8} more</dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                    </div>
                  </li>);
              })}
            </ul>

            <div className="cardTight spread">
              <span className="subtle small">
                Showing {data.offset + 1} to {Math.min(data.offset + data.entries.length, data.total)} of {data.total.toLocaleString('en-KE')}
              </span>
              <span className="row">
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                  Previous
                </button>
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + data.entries.length >= data.total}>
                  Next
                </button>
              </span>
            </div>
          </>) : null}
      </section>
    </>);
}
