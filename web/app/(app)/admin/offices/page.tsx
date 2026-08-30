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
    office_label: string | null;
    scope: string;
    term_start: string;
    term_end: string | null;
    member_id: string;
    full_name: string;
    prayer_house: string | null;
    confers_admin: boolean;
    term_due_on: string | null;
    term_overdue: boolean;
    terms_completed: number;
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
    const parish = sitting.filter((o) => o.scope === 'parish');
    const houses = sitting.filter((o) => o.scope === 'prayer_house');
    const overdue = sitting.filter((o) => o.term_overdue);
    return (<>
      <PageHeader title="Offices" description="Administrative access follows the office, not the person, and only a sitting parish term carries it. When a term closes, the access goes with it." actions={<button type="button" className="btn btnPrimary" onClick={() => setHandingOver((o) => !o)} aria-expanded={handingOver}>
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
        {overdue.length > 0 ? (
          <p className="noticeWarn" role="status">
            {overdue.length === 1
              ? 'One term has run past three years and is due for an election.'
              : `${overdue.length} terms have run past three years and are due for an election.`}
          </p>
        ) : null}

        <section className="card" aria-labelledby="parish">
          <div className="cardHeader">
            <h2 id="parish">Parish executive</h2>
            <span className="subtle small">{parish.length} sitting</span>
          </div>
          {parish.length === 0 ? (<EmptyState title="No sitting parish officers" description="Nobody currently holds a parish office."/>) : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Office</th><th scope="col">Holder</th>
                    <th scope="col">Since</th><th scope="col">Term due</th>
                    <th scope="col">Grants admin</th>
                  </tr>
                </thead>
                <tbody>
                  {parish.map((o) => (<tr key={o.id}>
                      <td>{o.office_label ?? officeLabel(o.office_key)}</td>
                      <td><Link href={`/admin/members/${o.member_id}`}>{o.full_name}</Link></td>
                      <td>{formatDate(o.term_start)}</td>
                      <td>
                        {formatDate(o.term_due_on)}
                        {o.term_overdue ? <> <Pill>Overdue</Pill></> : null}
                      </td>
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

        <section className="card" aria-labelledby="houses">
          <div className="cardHeader">
            <h2 id="houses">Prayer house leaders</h2>
            <span className="subtle small">{houses.length} sitting</span>
          </div>
          {houses.length === 0 ? (<EmptyState title="No prayer house officers recorded" description="Use Record an election, set the level to Prayer house, and enter each house in turn."/>) : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Prayer house</th><th scope="col">Office</th>
                    <th scope="col">Holder</th><th scope="col">Since</th>
                    <th scope="col">Term due</th>
                  </tr>
                </thead>
                <tbody>
                  {houses.map((o) => (<tr key={o.id}>
                      <td>{o.prayer_house ?? '--'}</td>
                      <td>{o.office_label ?? officeLabel(o.office_key)}</td>
                      <td><Link href={`/admin/members/${o.member_id}`}>{o.full_name}</Link></td>
                      <td>{formatDate(o.term_start)}</td>
                      <td>
                        {formatDate(o.term_due_on)}
                        {o.term_overdue ? <> <Pill>Overdue</Pill></> : null}
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
                    <th scope="col">Level</th><th scope="col">Office</th>
                    <th scope="col">Holder</th>
                    <th scope="col">From</th><th scope="col">To</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((o) => (<tr key={o.id}>
                      <td>{o.scope === 'prayer_house' ? (o.prayer_house ?? 'Prayer house') : 'Parish'}</td>
                      <td>{o.office_label ?? officeLabel(o.office_key)}</td>
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
