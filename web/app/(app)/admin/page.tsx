'use client';

import { useResource } from '@/lib/useResource';
import { ErrorState, LoadingState, PageHeader, Stat, StatGrid } from '@/components/ui';
import { formatKes } from '@/lib/format';
import { BackupStatusCard } from '@/components/BackupStatusCard';
import { DownloadButton } from '@/components/DownloadButton';
interface SummaryResponse {
    summary: {
        members: number;
        active_members: number;
        prayer_houses: number;
        sitting_officers: number;
        events: number;
        scored_events: number;
        attendance_records: number;
        contributions: number;
        contributions_total: string;
        audit_entries: number;
        welfare_pending: number;
        welfare_approved_unpaid: number;
        welfare_paid_total: string;
    };
}
export default function AdminOverview() {
    const { data, error, loading, reload } = useResource<SummaryResponse>('/api/admin/summary');
    if (loading)
        return <LoadingState label="Loading the register"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const s = data!.summary;
    return (<>
      <PageHeader title="Administration" description="Counts below are read directly from the register. Nothing here is estimated."/>

      <StatGrid>
        <Stat label="Members" value={s.members} hint={`${s.active_members} active`}/>
        <Stat label="Prayer houses" value={s.prayer_houses}/>
        <Stat label="Sitting officers" value={s.sitting_officers} hint="Open office terms"/>
        <Stat label="Events" value={s.events} hint={`${s.scored_events} feed the Matrix`}/>
        <Stat label="Attendance records" value={s.attendance_records.toLocaleString('en-KE')}/>
        <Stat label="Contributions" value={s.contributions.toLocaleString('en-KE')} hint={formatKes(s.contributions_total)}/>
        <Stat label="Welfare paid" value={formatKes(s.welfare_paid_total)} hint="Section 5.3 support"/>
        <Stat label="Claims awaiting a decision" value={s.welfare_pending} hint={s.welfare_approved_unpaid > 0 ? `${s.welfare_approved_unpaid} approved, not yet paid` : undefined}/>
        <Stat label="Audit entries" value={s.audit_entries.toLocaleString('en-KE')} hint="Append-only"/>
      </StatGrid>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <BackupStatusCard/>
      </div>

      <section className="card" style={{ marginTop: 'var(--space-5)' }} aria-labelledby="exports">
        <div className="cardHeader">
          <h2 id="exports">Documents</h2>
          <span className="subtle small">Sealed and verifiable</span>
        </div>
        <div className="cardBody stack">
          <p className="muted">
            Formal records on the association letterhead, for the parish files and the Treasurer
            books. Each one carries a document number and a code anyone can scan to confirm it
            came from this office and has not been altered.
          </p>
          <p className="row" style={{ flexWrap: 'wrap' }}>
            <DownloadButton url="/api/exports/admin/exports/roster.pdf" filename="cma-changamwe-member-register.pdf" label="Member register"/>
            <DownloadButton url="/api/exports/admin/exports/contributions.pdf" filename="cma-changamwe-matoleo.pdf" label="Statement of matoleo"/>
            <DownloadButton url="/api/exports/admin/exports/matrix.pdf" filename="cma-changamwe-matrix.pdf" label="Matrix standing"/>
            <DownloadButton url="/api/exports/admin/exports/welfare.pdf" filename="cma-changamwe-welfare.pdf" label="Welfare support"/>
          </p>
          <p className="subtle small">
            The member register carries full ID numbers and next-of-kin details. Handle it as the
            personal data it is.
          </p>
        </div>
      </section>
    </>);
}
