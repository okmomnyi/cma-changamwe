'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDateTime, titleCase } from '@/lib/format';
interface AuditRow {
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    field_changed: string | null;
    old_value: string | null;
    new_value: string | null;
    changed_at: string;
    changed_by_username: string | null;
    changed_by_name: string | null;
}
interface AuditResponse {
    entries: AuditRow[];
    total: number;
    offset: number;
}
const ENTITY_TYPES = ['member', 'attendance', 'contribution', 'office', 'user', 'event'] as const;
const PAGE_SIZE = 50;
function preview(value: string | null): string {
    if (!value)
        return '--';
    return value.length > 90 ? `${value.slice(0, 90)}...` : value;
}
export default function AuditPage() {
    const [entity, setEntity] = useState('');
    const [offset, setOffset] = useState(0);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (entity)
        params.set('entity_type', entity);
    const { data, error, loading, reload } = useResource<AuditResponse>(`/api/admin/audit-log?${params}`);
    return (<>
      <PageHeader title="Audit log" description="Every change to a member record, attendance entry, contribution or office term, with who made it and when."/>

      <p className="card cardTight row" style={{ marginBottom: 'var(--space-5)' }}>
        <Lock size={16} aria-hidden="true" className="subtle"/>
        <span className="small muted">
          This log is append-only. The application database role holds no permission to update or
          delete these rows, and database triggers refuse the attempt even from the schema owner.
          Nothing shown here can be edited or erased from inside the system.
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
          {data ? <span className="subtle small">{data.total} recorded</span> : null}
        </div>

        {loading ? <LoadingState label="Loading the audit log"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.entries.length === 0 ? (<EmptyState title="No entries of that type" description="Try another record type."/>) : null}

        {data && data.entries.length > 0 ? (<>
            <div className="tableScroll">
              <table className="table">
                <caption className="srOnly">Audit log entries, most recent first</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Record</th>
                    <th scope="col">Action</th>
                    <th scope="col">Field</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((row) => (<tr key={row.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.changed_at)}</td>
                      <td>
                        {row.changed_by_name ?? <span className="subtle">System</span>}
                        {row.changed_by_username ? (<span className="subtle small" style={{ display: 'block' }}>
                            {row.changed_by_username}
                          </span>) : null}
                      </td>
                      <td><Pill>{titleCase(row.entity_type)}</Pill></td>
                      <td className="muted">{titleCase(row.action)}</td>
                      <td className="mono">{row.field_changed ?? '--'}</td>
                      <td className="mono subtle">{preview(row.old_value)}</td>
                      <td className="mono">{preview(row.new_value)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <div className="cardTight spread">
              <span className="subtle small">
                Showing {data.offset + 1}-{Math.min(data.offset + data.entries.length, data.total)} of {data.total}
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
