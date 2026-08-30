'use client';

import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill, Stat, StatGrid } from '@/components/ui';
import { formatDate, formatKes, formatMonth, titleCase } from '@/lib/format';

interface ClaimRow {
    id: string;
    support_type: string;
    amount: string;
    status: string;
    period: string | null;
    subject_name: string | null;
    requested_at: string;
    decided_at: string | null;
    paid_at: string | null;
    event_title: string | null;
    child_name: string | null;
}

interface WelfareResponse {
    claims: ClaimRow[];
    paid_total: string;
}

const SUPPORT_LABELS: Record<string, string> = {
    pre_wedding: 'Pre-wedding support',
    wedding_gift: 'Wedding gift',
    sickness_advance: 'Sickness advance',
    benevolent_member_spouse: 'Benevolent, member or spouse',
    benevolent_child: 'Benevolent, child',
    benevolent_parent: 'Benevolent, parent',
};

export default function PortalWelfarePage() {
    const { data, error, loading, reload } = useResource<WelfareResponse>('/api/me/welfare');

    if (loading) return <LoadingState label="Loading your welfare record"/>;
    if (error) return <ErrorState error={error} onRetry={reload}/>;

    const claims = data!.claims;
    const paid = claims.filter((c) => c.status === 'paid').length;

    return (<>
      <PageHeader
        title="Welfare support"
        description="Support the association has given you, and anything still being decided. Speak to the Secretary or the Coordinator to ask for support."/>

      <StatGrid>
        <Stat label="Received in total" value={formatKes(data!.paid_total)}/>
        <Stat label="Payments made" value={paid}/>
        <Stat label="On record" value={claims.length}/>
      </StatGrid>

      <section className="card" style={{ marginTop: 'var(--space-5)' }} aria-labelledby="claims">
        <div className="cardHeader"><h2 id="claims">Your claims</h2></div>

        {claims.length === 0 ? (
          <EmptyState title="Nothing on record"
            description="Wedding, sickness and bereavement support appear here once an officer has recorded them. Nothing is hidden from you."/>
        ) : (<div className="tableScroll">
          <table className="table">
            <caption className="srOnly">Welfare claims, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Support</th>
                <th scope="col" className="numeric">Amount</th>
                <th scope="col">Standing used</th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (<tr key={claim.id}>
                <td>
                  {SUPPORT_LABELS[claim.support_type] ?? titleCase(claim.support_type)}
                  {claim.subject_name ? (
                    <span className="subtle small" style={{ display: 'block' }}>for {claim.subject_name}</span>
                  ) : null}
                  {claim.event_title ? (
                    <span className="subtle small" style={{ display: 'block' }}>{claim.event_title}</span>
                  ) : null}
                </td>
                <td className="numeric">{formatKes(claim.amount)}</td>
                <td className="muted small">
                  {claim.period ? formatMonth(`${claim.period}-01`) : 'Not yet decided'}
                </td>
                <td>
                  <Pill tone={claim.status === 'paid' ? 'navy' : 'neutral'}>
                    {claim.status === 'cancelled' ? 'withdrawn' : claim.status}
                  </Pill>
                </td>
                <td className="muted small">
                  {formatDate(claim.paid_at ?? claim.decided_at ?? claim.requested_at)}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>)}
      </section>

      <p className="muted small" style={{ marginTop: 'var(--space-5)' }}>
        Support under the by-laws depends on your Matrix standing for a completed month, on your
        yearly affiliation being paid in full, and on your bio-data being on file. Your Matrix
        score page shows where you stand and which items are short.
      </p>
    </>);
}
