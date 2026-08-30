'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Stat, StatGrid } from '@/components/ui';
import { StandingBadge } from '@/components/MatrixBreakdown';
import { DownloadButton } from '@/components/DownloadButton';
import { SnapshotPanel } from '@/components/SnapshotPanel';
interface LeaderboardRow {
    member_id: string;
    full_name: string;
    prayer_house: string;
    spirituality_score: number;
    financial_score: number;
    total_score: number;
    attainable_total: number;
    standing: string;
    gate_passed: boolean;
    gate_reasons: string[];
}
interface LeaderboardResponse {
    members: LeaderboardRow[];
    summary: Record<string, number>;
    evaluated: number;
}
interface HousesResponse {
    prayer_houses: Array<{
        id: string;
        name: string;
        member_count: number;
    }>;
}
const STANDINGS = [
    { value: '', label: 'All standings' },
    { value: 'in_good_standing', label: 'In good standing' },
    { value: 'below_threshold', label: 'Below threshold' },
    { value: 'insufficient_history', label: 'Not enough history' },
    { value: 'ineligible_gate', label: 'Not eligible' },
];
export default function AdminMatrixPage() {
    const [house, setHouse] = useState('');
    const [standing, setStanding] = useState('');
    const params = new URLSearchParams({ limit: '500' });
    if (house)
        params.set('prayer_house_id', house);
    if (standing)
        params.set('standing', standing);
    const { data, error, loading, reload } = useResource<LeaderboardResponse>(`/api/admin/matrix/leaderboard?${params}`);
    const houses = useResource<HousesResponse>('/api/admin/prayer-houses');
    return (<>
      <PageHeader title="Matrix" description="Live scores across the association. Figures are recalculated from current records each time this page loads." actions={<DownloadButton url="/api/exports/admin/exports/matrix.csv" filename="cma-changamwe-matrix.csv" label="Export period CSV"/>}/>

      {data ? (<StatGrid>
          <Stat label="In good standing" value={data.summary.in_good_standing ?? 0}/>
          <Stat label="Below threshold" value={data.summary.below_threshold ?? 0} hint="Appear on the pastoral list"/>
          <Stat label="Not enough history" value={data.summary.insufficient_history ?? 0}/>
          <Stat label="Not eligible" value={data.summary.ineligible_gate ?? 0} hint="Affiliation or profile outstanding"/>
        </StatGrid>) : null}

      <div style={{ margin: 'var(--space-5) 0' }}>
        <SnapshotPanel/>
      </div>

      <div className="card cardTight row" style={{ margin: 'var(--space-5) 0', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '0 1 14rem' }}>
          <label className="fieldLabel" htmlFor="house">Prayer house</label>
          <select id="house" className="input" value={house} onChange={(e) => setHouse(e.target.value)}>
            <option value="">All prayer houses</option>
            {houses.data?.prayer_houses.map((h) => (<option key={h.id} value={h.id}>{h.name}</option>))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 1 14rem' }}>
          <label className="fieldLabel" htmlFor="standing">Standing</label>
          <select id="standing" className="input" value={standing} onChange={(e) => setStanding(e.target.value)}>
            {STANDINGS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Members</h2>
          {data ? <span className="subtle small">{data.members.length} shown</span> : null}
        </div>

        {loading ? <LoadingState label="Scoring the association"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.members.length === 0 ? (<EmptyState title="No members match those filters"/>) : null}

        {data && data.members.length > 0 ? (<div className="tableScroll">
            <table className="table">
              <caption className="srOnly">Matrix scores, highest first</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Prayer house</th>
                  <th scope="col" className="numeric">Spirituality</th>
                  <th scope="col" className="numeric">Financial</th>
                  <th scope="col" className="numeric">Total</th>
                  <th scope="col">Standing</th>
                  <th scope="col">Report</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((row) => (<tr key={row.member_id}>
                    <td><Link href={`/admin/members/${row.member_id}`}>{row.full_name}</Link></td>
                    <td className="muted">{row.prayer_house}</td>
                    <td className="numeric">{row.spirituality_score.toFixed(2)}</td>
                    <td className="numeric">{row.financial_score.toFixed(2)}</td>
                    <td className="numeric">
                      <strong>{row.total_score.toFixed(2)}</strong>
                      <span className="subtle small"> / {row.attainable_total.toFixed(0)}</span>
                    </td>
                    <td>
                      <StandingBadge standing={row.standing}/>
                      {!row.gate_passed && row.gate_reasons.length > 0 ? (<span className="subtle small" style={{ display: 'block', marginTop: '0.25rem' }}>
                          {row.gate_reasons[0]}
                        </span>) : null}
                    </td>
                    <td>
                      <DownloadButton url={`/api/exports/admin/members/${row.member_id}/matrix.pdf`} filename={`${row.full_name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-matrix.pdf`} label="PDF" variant="btnGhost"/>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>) : null}
      </section>
    </>);
}
