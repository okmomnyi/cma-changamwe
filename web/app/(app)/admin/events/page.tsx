'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { eventTypeLabel, formatDate, matrixItemLabel } from '@/lib/format';
import { NewEventForm } from '@/components/NewEventForm';
interface EventRow {
    id: string;
    type: string;
    subtype: string | null;
    matrix_item_key: string | null;
    novena_series_id: string | null;
    title: string;
    date: string;
    attendance_recorded: number;
    present_or_apology: number;
}
interface EventsResponse {
    events: EventRow[];
    total: number;
    offset: number;
}
const PAGE_SIZE = 50;
export default function EventsPage() {
    const [offset, setOffset] = useState(0);
    const [adding, setAdding] = useState(false);
    const { data, error, loading, reload } = useResource<EventsResponse>(`/api/admin/events?limit=${PAGE_SIZE}&offset=${offset}`);
    return (<>
      <PageHeader title="Programme" description="Only events carrying a Matrix item feed the score. This is how Friday mass is separated from Wednesday mass." actions={<button type="button" className="btn btnPrimary" onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
            <Plus size={15} aria-hidden="true"/>
            {adding ? 'Close' : 'Add events'}
          </button>}/>

      {adding ? (<section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Add events">
          <div className="cardHeader"><h2>Add to the programme</h2></div>
          <div className="cardBody">
            <NewEventForm onCreated={() => { setOffset(0); reload(); }}/>
          </div>
        </section>) : null}

      <section className="card">
        <div className="cardHeader">
          <h2>Events</h2>
          {data ? <span className="subtle small">{data.total} recorded</span> : null}
        </div>

        {loading ? <LoadingState label="Loading the programme"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.events.length === 0 ? (<EmptyState title="No events recorded" description="Use Add events to create the first one."/>) : null}

        {data && data.events.length > 0 ? (<>
            <div className="tableScroll">
              <table className="table">
                <caption className="srOnly">Programme of events, most recent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Event</th>
                    <th scope="col">Type</th>
                    <th scope="col">Matrix item</th>
                    <th scope="col" className="numeric">Register</th>
                    <th scope="col" className="numeric">Present or apology</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (<tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td>
                      <td>
                        <Link href={`/admin/events/${e.id}`}>{e.title}</Link>
                        {e.novena_series_id ? (<span className="subtle small" style={{ display: 'block' }}>
                            Part of a novena series
                          </span>) : null}
                      </td>
                      <td className="muted">
                        {eventTypeLabel(e.type)}{e.subtype ? ` (${e.subtype})` : ''}
                      </td>
                      <td>
                        {e.matrix_item_key
                    ? <Pill tone="navy">{matrixItemLabel(e.matrix_item_key)}</Pill>
                    : <span className="subtle small">Not scored</span>}
                      </td>
                      <td className="numeric muted">{e.attendance_recorded}</td>
                      <td className="numeric muted">{e.present_or_apology}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <div className="cardTight spread">
              <span className="subtle small">
                Showing {data.offset + 1}-{Math.min(data.offset + data.events.length, data.total)} of {data.total}
              </span>
              <span className="row">
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                  Previous
                </button>
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + data.events.length >= data.total}>
                  Next
                </button>
              </span>
            </div>
          </>) : null}
      </section>
    </>);
}
