'use client';

import { Lock } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { Detail, DetailGrid, EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDate, formatDateTime, officeLabel, titleCase } from '@/lib/format';
import { EmailChange } from '@/components/EmailChange';
import { PasswordChange } from '@/components/PasswordChange';
import { MemberPhoto } from '@/components/MemberPhoto';
import { useAuth } from '@/lib/auth';
import { DownloadButton } from '@/components/DownloadButton';
interface ProfileResponse {
    member: Record<string, string | number | boolean | null>;
    children: Array<{
        id: string;
        name: string;
        date_of_birth: string | null;
    }>;
    offices: Array<{
        office_key: string;
        scope: string;
        term_start: string;
        term_end: string | null;
    }>;
}
const text = (value: unknown): string => value === null || value === undefined || value === '' ? '--' : String(value);
export default function ProfilePage() {
    const { user } = useAuth();
    const { data, error, loading, reload } = useResource<ProfileResponse>('/api/me/profile');
    if (loading)
        return <LoadingState label="Loading your profile"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const m = data!.member;
    const locked = Boolean(m.profile_locked);
    return (<>
      <PageHeader title="My profile" description="Your bio-data as held by the parish. Everything here is read-only." actions={<DownloadButton url="/api/exports/me/biodata.pdf" filename="my-biodata.pdf" label="Download PDF"/>}/>

      <p className="card cardTight row" style={{ marginBottom: 'var(--space-5)' }}>
        <Lock size={16} aria-hidden="true" className="subtle"/>
        <span className="small muted">
          {locked
            ? 'Your profile is locked. To correct any detail, speak to the Coordinator or Treasurer. Every change they make is recorded in the audit log.'
            : 'Your profile is not locked yet. It locks once your biodata is complete.'}
        </span>
      </p>

      <div className="stack">
        <section className="card" aria-labelledby="personal">
          <div className="cardHeader"><h2 id="personal">Personal details</h2></div>
          <div className="cardBody row" style={{ alignItems: 'flex-start', gap: 'var(--space-5)' }}>
            <MemberPhoto url="/api/me/photo/url" alt={`Photograph of ${text(m.full_name)}`}/>
            <DetailGrid>
              <Detail label="Full name">{text(m.full_name)}</Detail>
              <Detail label="Year of birth">{text(m.year_of_birth)}</Detail>
              <Detail label="ID / passport number">{text(m.id_or_passport_no)}</Detail>
              <Detail label="Mobile number">{text(m.mobile_no)}</Detail>
              <Detail label="Prayer house">{text(m.prayer_house)}</Detail>
              <Detail label="Jumuiya">{text(m.jumuiya)}</Detail>
              <Detail label="Home parish / diocese">{text(m.home_parish_diocese)}</Detail>
              <Detail label="Membership status">{titleCase(text(m.membership_status))}</Detail>
            </DetailGrid>
          </div>
        </section>

        <section className="card" aria-labelledby="family">
          <div className="cardHeader"><h2 id="family">Family details</h2></div>
          <div className="cardBody">
            <DetailGrid>
              <Detail label="Marital status">{titleCase(text(m.marital_status))}</Detail>
              <Detail label="Spouse name">{text(m.spouse_name)}</Detail>
              <Detail label="Spouse status">{titleCase(text(m.spouse_status))}</Detail>
              <Detail label="Father">{titleCase(text(m.father_status))}</Detail>
              <Detail label="Mother">{titleCase(text(m.mother_status))}</Detail>
            </DetailGrid>
          </div>
        </section>

        <section className="card" aria-labelledby="children">
          <div className="cardHeader">
            <h2 id="children">Children</h2>
            <span className="subtle small">{data!.children.length} recorded</span>
          </div>
          {data!.children.length === 0 ? (<EmptyState title="No children recorded" description="Children on your biodata form appear here."/>) : (<div className="tableScroll">
              <table className="table">
                <thead>
                  <tr><th scope="col">Name</th><th scope="col">Date of birth</th></tr>
                </thead>
                <tbody>
                  {data!.children.map((child) => (<tr key={child.id}>
                      <td>{child.name}</td>
                      <td>{formatDate(child.date_of_birth)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </section>

        <section className="card" aria-labelledby="kin">
          <div className="cardHeader"><h2 id="kin">Next of kin</h2></div>
          <div className="cardBody">
            <DetailGrid>
              <Detail label="Name">{text(m.next_of_kin_name)}</Detail>
              <Detail label="ID number">{text(m.next_of_kin_id_no)}</Detail>
              <Detail label="Mobile number">{text(m.next_of_kin_mobile)}</Detail>
            </DetailGrid>
          </div>
        </section>

        {data!.offices.length > 0 ? (<section className="card" aria-labelledby="offices">
            <div className="cardHeader"><h2 id="offices">Offices held</h2></div>
            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Office</th><th scope="col">Term start</th>
                    <th scope="col">Term end</th><th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.offices.map((office) => (<tr key={`${office.office_key}-${office.term_start}`}>
                      <td>{officeLabel(office.office_key)}</td>
                      <td>{formatDate(office.term_start)}</td>
                      <td>{office.term_end ? formatDate(office.term_end) : '--'}</td>
                      <td>{office.term_end ? <Pill>Past</Pill> : <Pill tone="navy">Currently sitting</Pill>}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          </section>) : null}

        
        <section className="card" aria-labelledby="account">
          <div className="cardHeader"><h2 id="account">Account</h2></div>
          <div className="cardBody" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {user ? <EmailChange currentEmail={user.email}/> : null}
            <PasswordChange/>
          </div>
        </section>

        <section className="card" aria-labelledby="declaration">
          <div className="cardHeader"><h2 id="declaration">Declaration</h2></div>
          <div className="cardBody">
            <DetailGrid>
              <Detail label="Submitted on">
                {formatDateTime((m.declaration_accepted_at ?? m.created_at) as string | null)}
              </Detail>
            </DetailGrid>
          </div>
        </section>
      </div>
    </>);
}
