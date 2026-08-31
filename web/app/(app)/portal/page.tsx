'use client';

import Link from 'next/link';
import { ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useResource } from '@/lib/useResource';
import { DemoNotice, ErrorState, LoadingState, PageHeader, Stat, StatGrid } from '@/components/ui';
import { StandingBadge } from '@/components/MatrixBreakdown';
import { MemberPhoto } from '@/components/MemberPhoto';
import { formatKes, titleCase } from '@/lib/format';
import styles from './portal.module.css';
interface ProfileResponse {
    member: {
        full_name: string;
        prayer_house: string;
        membership_status: string;
        profile_locked: boolean;
        id_or_passport_no: string;
    };
}
interface AttendanceResponse {
    total: number;
    records: Array<{
        status: string;
        counts_for_matrix: boolean;
    }>;
}
interface ContributionsResponse {
    total: number;
    by_category: Array<{
        category: string;
        total: string;
        n: string;
    }>;
}
interface MatrixResponse {
    total_score: number;
    spirituality_score: number;
    financial_score: number;
    attainable_total: number;
    standing: string;
    gate: {
        passed: boolean;
        affiliation_paid: boolean;
        profile_locked: boolean;
        reasons: string[];
    };
}
export default function PortalOverview() {
    const { user } = useAuth();
    const profile = useResource<ProfileResponse>('/api/me/profile');
    const attendance = useResource<AttendanceResponse>('/api/me/attendance?limit=200');
    const contributions = useResource<ContributionsResponse>('/api/me/contributions?limit=1');
    const matrix = useResource<MatrixResponse>('/api/me/matrix');
    if (profile.loading)
        return <LoadingState label="Loading your record"/>;
    if (profile.error)
        return <ErrorState error={profile.error} onRetry={profile.reload}/>;
    const member = profile.data!.member;
    const isDemo = member.id_or_passport_no?.startsWith('DEMO-');
    const contributedTotal = contributions.data?.by_category.reduce((sum, row) => sum + Number(row.total), 0);
    return (<>
      <PageHeader title={`Habari, ${member.full_name.split(' ')[0]}`} description={`${member.prayer_house} prayer house - membership ${titleCase(member.membership_status).toLowerCase()}.`} avatar={<MemberPhoto url="/api/me/photo/url" alt={`Photograph of ${member.full_name}`} size="avatarLg"/>}/>

      {isDemo ? <DemoNotice /> : null}

      <StatGrid>
        <Stat label="Attendance recorded" value={attendance.loading ? '--' : (attendance.data?.total ?? 0)} hint="Events where a register entry exists for you"/>
        <Stat label="Contributions recorded" value={contributions.loading ? '--' : (contributions.data?.total ?? 0)} hint="Individual matoleo entries"/>
        <Stat label="Contributed in total" value={contributions.loading ? '--' : formatKes(contributedTotal ?? 0)} hint="Sum of every recorded contribution"/>
        <Stat label="Profile" value={member.profile_locked ? 'Locked' : 'Open'} hint={member.profile_locked ? 'Changes are made by the Secretary' : 'Complete your biodata to lock it'}/>
      </StatGrid>

      <div className={styles.panels}>
        <section className="card" aria-labelledby="standing-heading">
          <div className="cardHeader">
            <h2 id="standing-heading">Welfare standing</h2>
            {matrix.data ? <StandingBadge standing={matrix.data.standing}/> : null}
          </div>
          <div className="cardBody stack">
            {matrix.loading ? <LoadingState label="Working out your score"/> : null}
            {matrix.error ? <ErrorState error={matrix.error} onRetry={matrix.reload}/> : null}
            {matrix.data ? (<>
                <p className={styles.scoreLine}>
                  <span className={styles.scoreValue}>{matrix.data.total_score.toFixed(2)}</span>
                  <span className="muted"> of {matrix.data.attainable_total.toFixed(0)} attainable</span>
                </p>

                <div className={styles.gateRow}>
                  {matrix.data.gate.passed ? (<ShieldCheck className={styles.gateOk} size={20} aria-hidden="true"/>) : (<ShieldAlert className={styles.gateWarn} size={20} aria-hidden="true"/>)}
                  <div>
                    <p className={styles.gateTitle}>
                      {matrix.data.gate.passed
                ? 'You meet the eligibility requirements'
                : 'You do not yet meet the eligibility requirements'}
                    </p>
                    <ul className={styles.gateList}>
                      <li>
                        {matrix.data.gate.affiliation_paid ? 'Paid' : 'Not paid'}: diocese affiliation
                      </li>
                      <li>
                        {matrix.data.gate.profile_locked ? 'Complete' : 'Incomplete'}: bio-data profile
                      </li>
                    </ul>
                  </div>
                </div>

                <Link className="btn btnSecondary" href="/portal/matrix">
                  See the full breakdown
                </Link>
              </>) : null}
          </div>
        </section>

        <section className="card" aria-labelledby="next-heading">
          <div className="cardHeader">
            <h2 id="next-heading">Your records</h2>
          </div>
          <ul className={styles.linkList}>
            <li>
              <Link href="/portal/attendance" className={styles.linkRow}>
                <span>Attendance history</span>
                <ArrowRight size={16} aria-hidden="true"/>
              </Link>
            </li>
            <li>
              <Link href="/portal/matoleo" className={styles.linkRow}>
                <span>Matoleo history</span>
                <ArrowRight size={16} aria-hidden="true"/>
              </Link>
            </li>
            <li>
              <Link href="/portal/profile" className={styles.linkRow}>
                <span>Biodata profile</span>
                <ArrowRight size={16} aria-hidden="true"/>
              </Link>
            </li>
            {user?.is_admin ? (<li>
                <Link href="/admin" className={styles.linkRow}>
                  <span>Administration</span>
                  <ArrowRight size={16} aria-hidden="true"/>
                </Link>
              </li>) : null}
          </ul>
        </section>
      </div>
    </>);
}
