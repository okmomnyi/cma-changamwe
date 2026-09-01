'use client';

import { useState } from 'react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill, StatusPill } from '@/components/ui';
import { eventTypeLabel, formatDate, matrixItemLabel } from '@/lib/format';
interface AttendanceRow {
    id: string;
    status: string;
    reason: string | null;
    title: string;
    date: string;
    type: string;
    subtype: string | null;
    matrix_item_key: string | null;
    counts_for_matrix: boolean;
}
interface AttendanceResponse {
    records: AttendanceRow[];
    total: number;
    limit: number;
    offset: number;
}
const PAGE_SIZE = 50;
export default function AttendancePage() {
    const [offset, setOffset] = useState(0);
    const { data, error, loading, reload } = useResource<AttendanceResponse>(`/api/me/attendance?limit=${PAGE_SIZE}&offset=${offset}`);
    return (<>
      <PageHeader title="Attendance" description="Every event where the parish recorded a register entry for you. An apology is recorded and shown as an apology, never as an absence."/>

      <section className="card">
        <div className="cardHeader">
          <h2>History</h2>
          {data ? <span className="subtle small">{data.total} records</span> : null}
        </div>

        {loading ? <LoadingState label="Loading your attendance"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.records.length === 0 ? (<EmptyState title="No attendance recorded yet" description="Once an administrator marks a register for an event you attended, it appears here."/>) : null}

        {data && data.records.length > 0 ? (<>
            <div className="tableScroll">
              <table className="table">
                <caption className="srOnly">Your attendance history, most recent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Event</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Counts toward Matrix</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((row) => (<tr key={row.id}>
                      <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>
                      <td data-label="Event">{row.title}</td>
                      <td data-label="Type" className="muted">
                        {eventTypeLabel(row.type)}
                        {row.subtype ? ` (${row.subtype})` : ''}
                      </td>
                      <td data-label="Status"><StatusPill status={row.status}/></td>
                      <td data-label="Reason" className="muted">{row.reason ?? '--'}</td>
                      <td data-label="Counts toward Matrix">
                        
                        {row.counts_for_matrix
                    ? <Pill tone="navy">{matrixItemLabel(row.matrix_item_key)}</Pill>
                    : <span className="subtle small">No</span>}
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <div className="cardTight spread">
              <span className="subtle small">
                Showing {data.offset + 1}-{Math.min(data.offset + data.records.length, data.total)} of {data.total}
              </span>
              <span className="row">
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>Previous</button>
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + data.records.length >= data.total}>Next</button>
              </span>
            </div>
          </>) : null}
      </section>
    </>);
}
