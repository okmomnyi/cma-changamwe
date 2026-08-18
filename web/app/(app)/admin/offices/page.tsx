'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Repeat } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDate, officeLabel } from '@/lib/format';
import { OfficeHandoff } from '@/components/OfficeHandoff';
interface OfficeRow {
    id: string;
    office_key: string;
    scope: string;
    term_start: string;
    term_end: string | null;
    member_id: string;
    full_name: string;
    prayer_house: string | null;
    confers_admin: boolean;
}
export default function OfficesPage() {
    const [handingOver, setHandingOver] = useState(false);
    const { data, error, loading, reload } = useResource<{
        offices: OfficeRow[];
    }>('/api/admin/offices');
    if (loading)
        return <LoadingState label="Loading office terms"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const sitting = data!.offices.filter((o) => o.term_end === null);
    const past = data!.offices.filter((o) => o.term_end !== null);
    return (<>
      <PageHeader title="Offices" description="Administrative access follows the office, not the person. Whoever currently sits as Coordinator or Treasurer has it; when a term closes, it goes with them." actions={<button type="button" className="btn btnPrimary" onClick={() => setHandingOver((o) => !o)} aria-expanded={handingOver}>
            <Repeat size={15} aria-hidden="true"/>
            {handingOver ? 'Close' : 'Record an election'}
          </button>}/>

      {handingOver ? (<section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Record an election">
          <div className="cardHeader"><h2>Election handoff</h2></div>
          <div className="cardBody">
            <OfficeHandoff onDone={reload}/>
          </div>
        </section>) : null}

      <div className="stack">
        <section className="card" aria-labelledby="sitting">
          <div className="cardHeader">
            <h2 id="sitting">Currently sitting</h2>
            <span className="subtle small">{sitting.length} open terms</span>
          </div>
          {sitting.length === 0 ? (<EmptyState title="No open office terms" description="Nobody currently holds an office."/>) : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Office</th><th scope="col">Holder</th>
                    <th scope="col">Since</th><th scope="col">Grants admin</th>
                  </tr>
                </thead>
                <tbody>
                  {sitting.map((o) => (<tr key={o.id}>
                      <td>{officeLabel(o.office_key)}</td>
                      <td><Link href={`/admin/members/${o.member_id}`}>{o.full_name}</Link></td>
                      <td>{formatDate(o.term_start)}</td>
                      <td>
                        {o.confers_admin
                    ? <Pill tone="accent">Administrator</Pill>
                    : <span className="subtle small">No</span>}
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>

        <section className="card" aria-labelledby="past">
          <div className="cardHeader">
            <h2 id="past">Past terms</h2>
            <span className="subtle small">{past.length}</span>
          </div>
          {past.length === 0 ? (<EmptyState title="No closed terms yet" description="Terms closed at an election handoff are kept here permanently."/>) : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Office</th><th scope="col">Holder</th>
                    <th scope="col">From</th><th scope="col">To</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((o) => (<tr key={o.id}>
                      <td>{officeLabel(o.office_key)}</td>
                      <td><Link href={`/admin/members/${o.member_id}`}>{o.full_name}</Link></td>
                      <td>{formatDate(o.term_start)}</td>
                      <td>{formatDate(o.term_end)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>
      </div>
    </>);
}
