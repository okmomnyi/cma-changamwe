'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ScanLine, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { eventTypeLabel, formatDate, matrixItemLabel } from '@/lib/format';
import styles from './register.module.css';
import { summariseError } from '@/lib/formErrors';
type Status = 'present' | 'absent' | 'apology';
interface RegisterRow {
    member_id: string;
    full_name: string;
    prayer_house: string;
    attendance_id: string | null;
    status: Status | null;
    reason: string | null;
}
interface RegisterResponse {
    event: {
        id: string;
        title: string;
        date: string;
        type: string;
        subtype: string | null;
        matrix_item_key: string | null;
    };
    register: RegisterRow[];
}
export default function EventRegisterPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = use(params);
    const { data, error, loading, reload } = useResource<RegisterResponse>(`/api/admin/events/${id}/register`);
    const [marks, setMarks] = useState<Record<string, {
        status: Status;
        reason: string;
    }>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    useEffect(() => {
        if (!data)
            return;
        const initial: Record<string, {
            status: Status;
            reason: string;
        }> = {};
        for (const row of data.register) {
            initial[row.member_id] = { status: row.status ?? 'present', reason: row.reason ?? '' };
        }
        setMarks(initial);
    }, [data]);
    const counts = useMemo(() => {
        const tally = { present: 0, absent: 0, apology: 0 };
        for (const mark of Object.values(marks))
            tally[mark.status] += 1;
        return tally;
    }, [marks]);
    async function save() {
        if (!data)
            return;
        setSaving(true);
        setSaveError(null);
        setSaved(null);
        try {
            const entries = data.register.map((row) => ({
                member_id: row.member_id,
                status: marks[row.member_id]?.status ?? 'present',
                reason: marks[row.member_id]?.reason?.trim() || null,
            }));
            const result = await api<{
                created: number;
                updated: number;
                unchanged: number;
            }>(`/api/admin/events/${id}/attendance`, {
                method: 'PUT', body: JSON.stringify({ entries }),
            });
            setSaved(`Saved. ${result.created} new, ${result.updated} changed, ${result.unchanged} unchanged. ` +
                'Matrix scores read from this immediately.');
            reload();
        }
        catch (err) {
            setSaveError(summariseError(err));
        }
        finally {
            setSaving(false);
        }
    }
    function markAll(status: Status) {
        if (!data)
            return;
        const next: Record<string, {
            status: Status;
            reason: string;
        }> = {};
        for (const row of data.register) {
            next[row.member_id] = { status, reason: marks[row.member_id]?.reason ?? '' };
        }
        setMarks(next);
    }
    if (loading)
        return <LoadingState label="Loading the register"/>;
    if (error)
        return <ErrorState error={error} onRetry={reload}/>;
    const event = data!.event;
    return (<>
      <p style={{ marginBottom: 'var(--space-4)' }}>
        <Link href="/admin/events" className="row small" style={{ textDecoration: 'none' }}>
          <ArrowLeft size={15} aria-hidden="true"/>
          Back to the programme
        </Link>
      </p>

      <PageHeader title={event.title} description={`${formatDate(event.date)} - ${eventTypeLabel(event.type)}${event.subtype ? ` (${event.subtype})` : ''}`} actions={<>
            {event.matrix_item_key
            ? <Pill tone="navy">Feeds {matrixItemLabel(event.matrix_item_key)}</Pill>
            : <Pill>Not scored</Pill>}
            <Link href="/admin/attendance-sheets" className="btn btnSecondary">
              <ScanLine size={15} aria-hidden="true"/>
              Print a sheet instead
            </Link>
          </>}/>

      {saveError ? <p className={styles.error} role="alert">{saveError}</p> : null}
      {saved ? <p className={styles.notice} role="status">{saved}</p> : null}

      <div className={styles.toolbar}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="label">Mark everyone</span>
          <button type="button" className="btn btnSecondary" onClick={() => markAll('present')}>Present</button>
          <button type="button" className="btn btnSecondary" onClick={() => markAll('absent')}>Absent</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="pill pillPresent">{counts.present} present</span>
          <span className="pill pillApology">{counts.apology} apology</span>
          <span className="pill pillAbsent">{counts.absent} absent</span>
          <button type="button" className="btn btnPrimary" onClick={save} disabled={saving}>
            <Save size={15} aria-hidden="true"/>
            {saving ? 'Saving...' : 'Save register'}
          </button>
        </div>
      </div>

      <section className="card">
        <div className="tableScroll">
          <table className="table">
            <caption className="srOnly">Attendance register for {event.title}</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Prayer house</th>
                <th scope="col">Status</th>
                <th scope="col">Reason (apology only)</th>
              </tr>
            </thead>
            <tbody>
              {data!.register.map((row) => {
            const mark = marks[row.member_id] ?? { status: 'present' as Status, reason: '' };
            return (<tr key={row.member_id}>
                    <td data-label="Member">
                      {row.full_name}
                      {row.status ? (<span className="subtle small" style={{ display: 'block' }}>
                          already recorded as {row.status}
                        </span>) : null}
                    </td>
                    <td data-label="Prayer house" className="muted">{row.prayer_house}</td>
                    <td data-label="Status">
                      <fieldset className={styles.statusGroup}>
                        <legend className="srOnly">Attendance for {row.full_name}</legend>
                        {(['present', 'apology', 'absent'] as Status[]).map((status) => (<label key={status} className={styles.statusOption}>
                            <input type="radio" name={`status-${row.member_id}`} value={status} checked={mark.status === status} onChange={() => setMarks({ ...marks, [row.member_id]: { ...mark, status } })}/>
                            <span>{status}</span>
                          </label>))}
                      </fieldset>
                    </td>
                    <td data-label="Reason (apology only)">
                      <label className="srOnly" htmlFor={`reason-${row.member_id}`}>
                        Reason for {row.full_name}
                      </label>
                      <input id={`reason-${row.member_id}`} className="input" value={mark.reason} disabled={mark.status !== 'apology'} placeholder={mark.status === 'apology' ? 'e.g. travelling' : ''} onChange={(e) => setMarks({ ...marks, [row.member_id]: { ...mark, reason: e.target.value } })}/>
                    </td>
                  </tr>);
        })}
            </tbody>
          </table>
        </div>
      </section>
    </>);
}
