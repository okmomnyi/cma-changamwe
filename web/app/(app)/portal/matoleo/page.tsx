'use client';

import { useState } from 'react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { contributionLabel, formatDate, formatKes, formatMonth } from '@/lib/format';
interface ContributionRow {
    id: string;
    category: string;
    amount: string;
    date: string;
    contribution_month: string | null;
    affiliation_year: number | null;
    note: string | null;
    event_title: string | null;
}
interface ContributionsResponse {
    records: ContributionRow[];
    by_category: Array<{
        category: string;
        total: string;
        n: string;
    }>;
    total: number;
    offset: number;
}
const PAGE_SIZE = 50;
export default function MatoleoPage() {
    const [offset, setOffset] = useState(0);
    const { data, error, loading, reload } = useResource<ContributionsResponse>(`/api/me/contributions?limit=${PAGE_SIZE}&offset=${offset}`);
    return (<>
      <PageHeader title="Matoleo" description="Every contribution recorded against your name, by category."/>

      {loading ? <LoadingState label="Loading your contributions"/> : null}
      {error ? <ErrorState error={error} onRetry={reload}/> : null}

      {data ? (<div className="stack">
          <section className="card" aria-labelledby="by-category">
            <div className="cardHeader"><h2 id="by-category">Totals by category</h2></div>
            {data.by_category.length === 0 ? (<EmptyState title="Nothing recorded yet"/>) : (<div className="tableScroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" className="numeric">Entries</th>
                      <th scope="col" className="numeric">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_category.map((row) => (<tr key={row.category}>
                        <td data-label="Category">{contributionLabel(row.category)}</td>
                        <td data-label="Entries" className="numeric muted">{row.n}</td>
                        <td data-label="Total" className="numeric">{formatKes(row.total)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>)}
          </section>

          <section className="card" aria-labelledby="history">
            <div className="cardHeader">
              <h2 id="history">History</h2>
              <span className="subtle small">{data.total} records</span>
            </div>

            {data.records.length === 0 ? (<EmptyState title="No contributions recorded yet" description="Contributions recorded by the Treasurer appear here."/>) : (<>
                <div className="tableScroll">
                  <table className="table">
                    <caption className="srOnly">Your contribution history, most recent first</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Category</th>
                        <th scope="col">Applies to</th>
                        <th scope="col">Event</th>
                        <th scope="col" className="numeric">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.records.map((row) => (<tr key={row.id}>
                          <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>
                          <td data-label="Category">{contributionLabel(row.category)}</td>
                          <td data-label="Applies to" className="muted">
                            {row.contribution_month
                        ? formatMonth(row.contribution_month)
                        : row.affiliation_year
                            ? `Year ${row.affiliation_year}`
                            : '--'}
                          </td>
                          <td data-label="Event" className="muted">{row.event_title ?? '--'}</td>
                          <td data-label="Amount" className="numeric">{formatKes(row.amount)}</td>
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
              </>)}
          </section>
        </div>) : null}
    </>);
}
