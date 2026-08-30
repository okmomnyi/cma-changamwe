'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, UserPlus } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { officeLabel, titleCase } from '@/lib/format';
import { EnrolMemberForm } from '@/components/EnrolMemberForm';
interface MemberRow {
    id: string;
    full_name: string;
    mobile_no: string;
    prayer_house: string;
    membership_status: string;
    id_no_masked: string;
    username: string | null;
    offices: string[] | null;
}
interface MembersResponse {
    members: MemberRow[];
    total: number;
    offset: number;
}
interface HousesResponse {
    prayer_houses: Array<{
        id: string;
        name: string;
        member_count: number;
    }>;
}
const PAGE_SIZE = 50;
export default function MembersPage() {
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [house, setHouse] = useState('');
    const [offset, setOffset] = useState(0);
    const [enrolling, setEnrolling] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebounced(search.trim());
            setOffset(0);
        }, 250);
        return () => clearTimeout(timer);
    }, [search]);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debounced)
        params.set('q', debounced);
    if (house)
        params.set('prayer_house_id', house);
    const { data, error, loading, reload } = useResource<MembersResponse>(`/api/admin/members?${params}`);
    const houses = useResource<HousesResponse>('/api/admin/prayer-houses');
    return (<>
      <PageHeader title="Members" description="ID numbers are masked in this list. Open a member to see the full record."
        actions={<button type="button" className="btn btnPrimary" onClick={() => setEnrolling((o) => !o)} aria-expanded={enrolling}>
            <UserPlus size={15} aria-hidden="true"/>
            {enrolling ? 'Close' : 'Enrol a member'}
          </button>}/>

      {enrolling ? (<section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Enrol a member">
          <div className="cardHeader"><h2>Enrol a member</h2></div>
          <div className="cardBody">
            <EnrolMemberForm onCreated={reload}/>
          </div>
        </section>) : null}

      <div className="card cardTight row" style={{ marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 16rem' }}>
          <label className="fieldLabel" htmlFor="member-search">Search by name or mobile</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }}/>
            <input id="member-search" className="input" style={{ paddingLeft: '2rem' }} value={search} onChange={(e) => setSearch(e.target.value)} type="search" autoComplete="off" placeholder="e.g. Otieno"/>
          </div>
        </div>

        <div className="field" style={{ flex: '0 1 14rem' }}>
          <label className="fieldLabel" htmlFor="house-filter">Prayer house</label>
          <select id="house-filter" className="input" value={house} onChange={(e) => { setHouse(e.target.value); setOffset(0); }}>
            <option value="">All prayer houses</option>
            {houses.data?.prayer_houses.map((h) => (<option key={h.id} value={h.id}>{h.name} ({h.member_count})</option>))}
          </select>
        </div>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Directory</h2>
          {data ? <span className="subtle small">{data.total} members</span> : null}
        </div>

        {loading ? <LoadingState label="Searching the register"/> : null}
        {error ? <ErrorState error={error} onRetry={reload}/> : null}

        {data && data.members.length === 0 ? (<EmptyState title="No members match that search" description="Try a shorter name, or clear the prayer house filter."/>) : null}

        {data && data.members.length > 0 ? (<>
            <div className="tableScroll">
              <table className="table">
                <caption className="srOnly">Member directory</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Prayer house</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">ID number</th>
                    <th scope="col">Offices</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (<tr key={m.id}>
                      <td><Link href={`/admin/members/${m.id}`}>{m.full_name}</Link></td>
                      <td className="muted">{m.prayer_house}</td>
                      <td className="muted">{m.mobile_no}</td>
                      <td className="mono subtle">{m.id_no_masked}</td>
                      <td>
                        {m.offices?.length
                    ? m.offices.map((o) => <Pill key={o} tone="navy">{officeLabel(o)}</Pill>)
                    : <span className="subtle small">--</span>}
                      </td>
                      <td className="muted">{titleCase(m.membership_status)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <div className="cardTight spread">
              <span className="subtle small">
                Showing {data.offset + 1}-{Math.min(data.offset + data.members.length, data.total)} of {data.total}
              </span>
              <span className="row">
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                  Previous
                </button>
                <button type="button" className="btn btnSecondary" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + data.members.length >= data.total}>
                  Next
                </button>
              </span>
            </div>
          </>) : null}
      </section>
    </>);
}
