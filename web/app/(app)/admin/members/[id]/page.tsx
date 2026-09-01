'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { MemberEditForm } from '@/components/MemberEditForm';
import { MemberPhoto } from '@/components/MemberPhoto';
import { PhotoUpload } from '@/components/PhotoUpload';
import { Detail, DetailGrid, EmptyState, ErrorState, LoadingState, PageHeader, Pill, StatusPill, } from '@/components/ui';
import { contributionLabel, formatDate, formatDateTime, formatKes, officeLabel, titleCase, } from '@/lib/format';
import { DownloadButton } from '@/components/DownloadButton';
interface MemberDetailResponse {
    member: Record<string, string | number | boolean | null>;
    children: Array<{
        id: string;
        name: string;
        date_of_birth: string | null;
    }>;
    offices: Array<{
        office_key: string;
        term_start: string;
        term_end: string | null;
    }>;
    recent_attendance: Array<{
        status: string;
        reason: string | null;
        title: string;
        date: string;
    }>;
    recent_contributions: Array<{
        category: string;
        amount: string;
        date: string;
    }>;
}
const text = (value: unknown): string => value === null || value === undefined || value === '' ? '--' : String(value);
interface HousesResponse {
    prayer_houses: Array<{
        id: string;
        name: string;
    }>;
}
export default function MemberDetailPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = use(params);
    const [editing, setEditing] = useState(false);
    const { data, error, loading, reload } = useResource<MemberDetailResponse>(`/api/admin/members/${id}`);
    const houses = useResource<HousesResponse>('/api/admin/prayer-houses');
    if (loading)
        return <LoadingState label="Loading member record"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const m = data!.member;
    return (<>
      <p style={{ marginBottom: 'var(--space-4)' }}>
        <Link href="/admin/members" className="row small" style={{ textDecoration: 'none' }}>
          <ArrowLeft size={15} aria-hidden="true"/>
          Back to directory
        </Link>
      </p>

      <PageHeader title={text(m.full_name)} description={`${text(m.prayer_house)} prayer house`} actions={<>
            <DownloadButton url={`/api/exports/admin/members/${id}/biodata.pdf`} filename={`${text(m.full_name).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-biodata.pdf`} label="Bio-data PDF"/>
            <DownloadButton url={`/api/exports/admin/members/${id}/matrix.pdf`} filename={`${text(m.full_name).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-matrix.pdf`} label="Matrix PDF"/>
            <button type="button" className="btn btnPrimary" onClick={() => setEditing((o) => !o)} aria-expanded={editing}>
              <Pencil size={15} aria-hidden="true"/>
              {editing ? 'Close' : 'Edit record'}
            </button>
          </>}/>

      {editing ? (<section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Edit member record">
          <div className="cardHeader">
            <h2>Edit this record</h2>
            <span className="subtle small">Every change is written to the audit log</span>
          </div>
          <div className="cardBody">
            <div style={{ marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)',
                borderBottom: '1px solid var(--border)' }}>
              <PhotoUpload label="Photograph" hint="Replacing or removing a photograph is recorded in the audit log, like any other change to a locked profile." onChange={() => reload()} endpoints={{
                uploadUrl: `/api/admin/members/${id}/photo/upload-url`,
                confirm: `/api/admin/members/${id}/photo/confirm`,
                view: `/api/admin/members/${id}/photo/url`,
                remove: `/api/admin/members/${id}/photo`,
            }}/>
            </div>

            <MemberEditForm memberId={id} prayerHouses={houses.data?.prayer_houses ?? []} member={{
                full_name: text(m.full_name),
                year_of_birth: (m.year_of_birth ?? '') as number | string,
                id_or_passport_no: (m.id_or_passport_no ?? '') as string,
                mobile_no: (m.mobile_no ?? '') as string,
                home_parish_diocese: (m.home_parish_diocese ?? '') as string,
                jumuiya: (m.jumuiya ?? '') as string,
                prayer_house_id: (m.prayer_house_id ?? '') as string,
                marital_status: (m.marital_status ?? '') as string,
                spouse_name: (m.spouse_name ?? '') as string,
                membership_status: (m.membership_status ?? '') as string,
                next_of_kin_name: (m.next_of_kin_name ?? '') as string,
                next_of_kin_id_no: (m.next_of_kin_id_no ?? '') as string,
                next_of_kin_mobile: (m.next_of_kin_mobile ?? '') as string,
            }} onSaved={() => reload()}/>
          </div>
        </section>) : null}

      <div className="stack">
        <section className="card" aria-labelledby="record">
          <div className="cardHeader">
            <h2 id="record">Biodata</h2>
            {m.profile_locked ? <Pill tone="navy">Profile locked</Pill> : <Pill>Profile open</Pill>}
          </div>
          <div className="cardBody row" style={{ alignItems: 'flex-start', gap: 'var(--space-5)' }}>
            <MemberPhoto url={`/api/admin/members/${id}/photo/url`} alt={`Photograph of ${text(m.full_name)}`}/>
            <DetailGrid>
              <Detail label="Year of birth">{text(m.year_of_birth)}</Detail>
              <Detail label="ID / passport">{text(m.id_or_passport_no)}</Detail>
              <Detail label="Mobile">{text(m.mobile_no)}</Detail>
              <Detail label="Jumuiya">{text(m.jumuiya)}</Detail>
              <Detail label="Home parish / diocese">{text(m.home_parish_diocese)}</Detail>
              <Detail label="Marital status">{titleCase(text(m.marital_status))}</Detail>
              <Detail label="Spouse">{text(m.spouse_name)}</Detail>
              <Detail label="Father">{titleCase(text(m.father_status))}</Detail>
              <Detail label="Mother">{titleCase(text(m.mother_status))}</Detail>
              <Detail label="Next of kin">{text(m.next_of_kin_name)}</Detail>
              <Detail label="Next of kin ID">{text(m.next_of_kin_id_no)}</Detail>
              <Detail label="Next of kin mobile">{text(m.next_of_kin_mobile)}</Detail>
              <Detail label="Membership">{titleCase(text(m.membership_status))}</Detail>
              <Detail label="Username">{text(m.username)}</Detail>
              <Detail label="Email">{text(m.email)}</Detail>
              <Detail label="Submitted on">
                {formatDateTime((m.declaration_accepted_at ?? m.created_at) as string | null)}
              </Detail>
            </DetailGrid>
          </div>
        </section>

        <section className="card" aria-labelledby="offices">
          <div className="cardHeader"><h2 id="offices">Office terms</h2></div>
          {data!.offices.length === 0 ? <EmptyState title="No office terms recorded"/> : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr><th scope="col">Office</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th></tr>
                </thead>
                <tbody>
                  {data!.offices.map((o) => (<tr key={`${o.office_key}-${o.term_start}`}>
                      <td data-label="Office">{officeLabel(o.office_key)}</td>
                      <td data-label="From">{formatDate(o.term_start)}</td>
                      <td data-label="To">{o.term_end ? formatDate(o.term_end) : '--'}</td>
                      <td data-label="Status">{o.term_end ? <Pill>Closed</Pill> : <Pill tone="navy">Sitting</Pill>}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>

        <section className="card" aria-labelledby="children">
          <div className="cardHeader"><h2 id="children">Children</h2></div>
          {data!.children.length === 0 ? <EmptyState title="No children recorded"/> : (<div className="tableScroll">
              <table className="table">
                <thead><tr><th scope="col">Name</th><th scope="col">Date of birth</th></tr></thead>
                <tbody>
                  {data!.children.map((c) => (<tr key={c.id}><td data-label="Name">{c.name}</td><td data-label="Date of birth">{formatDate(c.date_of_birth)}</td></tr>))}
                </tbody>
              </table>
            </div>)}
        </section>

        <section className="card" aria-labelledby="attendance">
          <div className="cardHeader">
            <h2 id="attendance">Recent attendance</h2>
            <span className="subtle small">Last 25</span>
          </div>
          {data!.recent_attendance.length === 0 ? <EmptyState title="No attendance recorded"/> : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Status</th><th scope="col">Reason</th></tr>
                </thead>
                <tbody>
                  {data!.recent_attendance.map((a, i) => (<tr key={`${a.date}-${a.title}-${i}`}>
                      <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(a.date)}</td>
                      <td data-label="Event">{a.title}</td>
                      <td data-label="Status"><StatusPill status={a.status}/></td>
                      <td data-label="Reason" className="muted">{a.reason ?? '--'}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>

        <section className="card" aria-labelledby="contributions">
          <div className="cardHeader">
            <h2 id="contributions">Recent contributions</h2>
            <span className="subtle small">Last 25</span>
          </div>
          {data!.recent_contributions.length === 0 ? <EmptyState title="No contributions recorded"/> : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col" className="numeric">Amount</th></tr>
                </thead>
                <tbody>
                  {data!.recent_contributions.map((c, i) => (<tr key={`${c.date}-${c.category}-${i}`}>
                      <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.date)}</td>
                      <td data-label="Category">{contributionLabel(c.category)}</td>
                      <td data-label="Amount" className="numeric">{formatKes(c.amount)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>
      </div>
    </>);
}
