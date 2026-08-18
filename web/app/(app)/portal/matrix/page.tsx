'use client';

import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { MatrixBreakdown, StandingBadge, type MatrixPayload } from '@/components/MatrixBreakdown';
import { DownloadButton } from '@/components/DownloadButton';
import styles from './matrix.module.css';
export default function MatrixPage() {
    const { data, error, loading, reload } = useResource<MatrixPayload>('/api/me/matrix');
    if (loading)
        return <LoadingState label="Working out your score"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const gate = data!.gate;
    return (<>
      <PageHeader title="Matrix score" description="Participation measured out of 100 points: 60 for spirituality, 40 for financial contribution. Each item is scored proportionally." actions={<DownloadButton url="/api/exports/me/matrix.pdf" filename="my-matrix-report.pdf" label="Download PDF"/>}/>

      <div className="stack">
        <section className={`card ${styles.headline}`} aria-labelledby="score-heading">
          <div className={styles.totalBlock}>
            <h2 id="score-heading" className="label">Total score</h2>
            <p className={styles.total}>
              {data!.total_score.toFixed(2)}
              <span className={styles.outOf}>of {data!.attainable_total.toFixed(0)} attainable</span>
            </p>
          </div>

          <div className={styles.subScores}>
            <div>
              <p className="label">Spirituality</p>
              <p className={styles.subScore}>
                {data!.spirituality_score.toFixed(2)}
                <span className={styles.subScoreMax}>/ {data!.attainable_spirituality.toFixed(0)}</span>
              </p>
            </div>
            <div>
              <p className="label">Financial</p>
              <p className={styles.subScore}>
                {data!.financial_score.toFixed(2)}
                <span className={styles.subScoreMax}>/ {data!.attainable_financial.toFixed(0)}</span>
              </p>
            </div>
            <div>
              <p className="label">Standing</p>
              <p className={styles.standingCell}><StandingBadge standing={data!.standing}/></p>
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="gate-heading">
          <div className="cardHeader">
            <h2 id="gate-heading">Eligibility requirements</h2>
            <span className={gate.passed ? 'pill pillPresent' : 'pill pillApology'}>
              {gate.passed ? 'Met' : 'Not met'}
            </span>
          </div>
          <div className="cardBody">
            <ul className={styles.checkList}>
              <li>
                {gate.affiliation_paid
            ? <ShieldCheck size={18} className={styles.ok} aria-hidden="true"/>
            : <ShieldAlert size={18} className={styles.warn} aria-hidden="true"/>}
                <div>
                  <p className={styles.checkTitle}>Diocese affiliation paid for this year</p>
                  {!gate.affiliation_paid ? (<p className="muted small">Speak to the Treasurer to settle this.</p>) : null}
                </div>
              </li>
              <li>
                {gate.profile_locked
            ? <ShieldCheck size={18} className={styles.ok} aria-hidden="true"/>
            : <ShieldAlert size={18} className={styles.warn} aria-hidden="true"/>}
                <div>
                  <p className={styles.checkTitle}>Completed bio-data profile</p>
                </div>
              </li>
            </ul>

            {!gate.passed ? (<p className={styles.gateNote}>
                Until both are met your standing cannot be assessed, whatever your score.
                {gate.reasons.length > 0 ? ` ${gate.reasons.join(' ')}` : null}
              </p>) : null}
          </div>
        </section>

        <MatrixBreakdown data={data!}/>

        <p className="subtle small">
          These are live figures, recalculated from your records every time you open this page. The
          report emailed on the 1st of each month is a snapshot taken that day, so the two can
          differ if something has been recorded since.
        </p>
      </div>
    </>);
}
