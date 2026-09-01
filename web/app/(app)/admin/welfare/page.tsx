'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HandCoins, Plus } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill, Stat, StatGrid } from '@/components/ui';
import { NewClaimForm } from '@/components/NewClaimForm';
import { ClaimDecision } from '@/components/ClaimDecision';
import { formatDate, formatKes, formatMonth, titleCase } from '@/lib/format';
import { SUPPORT_LABELS, type ClaimRow } from '@/lib/welfare';

interface ClaimsResponse {
    claims: ClaimRow[];
    total: number;
    pending: number;
    paid_total: string;
    approved_unpaid_total: string;
}

const STATUS_TONE: Record<string, 'neutral' | 'navy' | 'accent'> = {
    pending: 'accent',
    approved: 'navy',
    paid: 'neutral',
    rejected: 'neutral',
    cancelled: 'neutral',
};

const FILTERS = [
    { value: '', label: 'All claims' },
    { value: 'pending', label: 'Awaiting a decision' },
    { value: 'approved', label: 'Approved, not yet paid' },
    { value: 'paid', label: 'Paid' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'cancelled', label: 'Withdrawn' },
];

export default function WelfarePage() {
    const [status, setStatus] = useState('');
    const [opening, setOpening] = useState(false);

    const params = new URLSearchParams({ limit: '200' });
    if (status) params.set('status', status);

    const { data, error, loading, reload } = useResource<ClaimsResponse>(
        `/api/admin/welfare/claims?${params}`,
    );

    return (<>
      <PageHeader
        title="Welfare support"
        description="What the association has paid out under section 5.3, and the standing each decision rested on. Eligibility comes from a member's closed month, not their score today, so a decision can still be explained a year later."
        actions={<button type="button" className="btn btnPrimary" onClick={() => setOpening((o) => !o)} aria-expanded={opening}>
            <Plus size={15} aria-hidden="true"/>
            {opening ? 'Close' : 'Open a claim'}
          </button>}/>

      {data ? (<StatGrid>
          <Stat label="Awaiting a decision" value={data.pending}/>
          <Stat label="Approved, not yet paid" value={formatKes(data.approved_unpaid_total)}/>
          <Stat label="Paid in total" value={formatKes(data.paid_total)}/>
          <Stat label="Claims on record" value={data.total}/>
        </StatGrid>) : null}

      {opening ? (<section className="card" style={{ margin: 'var(--space-5) 0' }} aria-label="Open a claim">
          <div className="cardHeader"><h2>Open a welfare claim</h2></div>
          <div className="cardBody">
            <NewClaimForm onCreated={() => { setOpening(false); reload(); }}/>
          </div>
        </section>) : null}

      <div className="card cardTight row" style={{ margin: 'var(--space-5) 0', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '0 1 16rem' }}>
          <label className="fieldLabel" htmlFor="status">Show</label>
          <select id="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Claims</h2>
          {data ? <span className="subtle small">{data.claims.length} shown</span> : null}
        </div>

        {loading ? <LoadingState label="Loading claims"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.claims.length === 0 ? (
          <EmptyState title="No claims recorded"
            description="Open one when a member asks for wedding, sickness or bereavement support. Nothing is paid out until an officer records the decision here."/>
        ) : null}

        {data && data.claims.length > 0 ? (<div className="tableScroll">
          <table className="table">
            <caption className="srOnly">Welfare claims, those awaiting a decision first</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Support</th>
                <th scope="col" className="numeric">Amount</th>
                <th scope="col">Standing relied on</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.claims.map((claim) => (<tr key={claim.id}>
                <td data-label="Member">
                  <Link href={`/admin/members/${claim.member_id}`}>{claim.full_name}</Link>
                  <span className="subtle small" style={{ display: 'block' }}>{claim.prayer_house}</span>
                </td>
                <td data-label="Support">
                  {SUPPORT_LABELS[claim.support_type] ?? titleCase(claim.support_type)}
                  {claim.subject_name ? (
                    <span className="subtle small" style={{ display: 'block' }}>for {claim.subject_name}</span>
                  ) : null}
                  {claim.event_title ? (
                    <span className="subtle small" style={{ display: 'block' }}>{claim.event_title}</span>
                  ) : null}
                  {claim.admitted_on && claim.discharged_on ? (
                    <span className="subtle small" style={{ display: 'block' }}>
                      {formatDate(claim.admitted_on)} to {formatDate(claim.discharged_on)}
                    </span>
                  ) : null}
                </td>
                <td data-label="Amount" className="numeric">{formatKes(claim.amount)}</td>
                <td data-label="Standing relied on">
                  {claim.period ? (<>
                    <span className="small">{formatMonth(`${claim.period}-01`)}</span>
                    <span className="subtle small" style={{ display: 'block' }}>
                      {claim.standing_relied_on ? titleCase(claim.standing_relied_on) : 'Month not closed'}
                      {claim.score_relied_on ? ` (${Number(claim.score_relied_on).toFixed(2)})` : ''}
                    </span>
                  </>) : <span className="subtle small">Not yet decided</span>}
                </td>
                <td data-label="Status">
                  <Pill tone={STATUS_TONE[claim.status] ?? 'neutral'}>
                    {claim.status === 'cancelled' ? 'withdrawn' : claim.status}
                  </Pill>
                  {claim.paid_at ? (
                    <span className="subtle small" style={{ display: 'block', marginTop: '0.25rem' }}>
                      {formatDate(claim.paid_at)}
                      {claim.payment_reference ? ` · ${claim.payment_reference}` : ''}
                    </span>
                  ) : null}
                  {claim.decision_note ? (
                    <span className="subtle small" style={{ display: 'block', marginTop: '0.25rem' }}>
                      {claim.decision_note}
                    </span>
                  ) : null}
                </td>
                <td data-label="Action"><ClaimDecision claim={claim} onDone={reload}/></td>
              </tr>))}
            </tbody>
          </table>
        </div>) : null}
      </section>

      <p className="muted small" style={{ marginTop: 'var(--space-5)' }}>
        <HandCoins size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.35rem' }}/>
        Amounts come from the by-laws, and can be changed on a claim where the committee agreed
        something different. Every decision and payment is recorded.
      </p>
    </>);
}
