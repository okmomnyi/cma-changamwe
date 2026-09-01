'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/useResource';
import { ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDate, formatDateTime, matrixItemLabel } from '@/lib/format';
import { summariseError } from '@/lib/formErrors';
import styles from './review.module.css';

/**
 * The gate. Nothing a camera decided is recorded until it has been through
 * this screen, because the ticks on that page decide who qualifies for welfare
 * money. The rows the reader could not call are flagged and sorted to the top;
 * everything else is already answered and only needs a glance.
 */

type Status = 'present' | 'absent' | 'apology';

interface ReviewRow {
    index: number;
    serial: number;
    member_id: string;
    full_name: string;
    prayer_house: string;
    detected_state: 'marked' | 'blank' | 'uncertain' | null;
    fill_ratio: number | null;
    confidence: number | null;
    proposed: Status;
    uncertain: boolean;
    recorded_status: Status | null;
    recorded_source: string | null;
}

interface CoveragePage {
    sheet_id: string;
    sheet_code: string;
    page_no: number;
    rows: number;
    scans: number;
    committed: boolean;
}

interface Review {
    scan: {
        id: string;
        status: string;
        reject_reason: string | null;
        uploaded_at: string;
        uploaded_by: string | null;
        reviewed_at: string | null;
        reviewed_by: string | null;
        committed_at: string | null;
        photo_available: boolean;
        quality: { blur: number; brightness: number; contrast: number } | null;
        registration: {
            alignment_error_px: number;
            outline_ink: number;
            rotated: boolean;
            pointer_read: string | null;
        } | null;
        thresholds: { low: number; high: number } | null;
    };
    sheet: {
        id: string;
        sheet_code: string;
        page_no: number;
        total_pages: number;
        template_version: string;
        prayer_house: string | null;
    };
    event: { id: string; title: string; date: string; type: string; matrix_item_key: string | null } | null;
    rows: ReviewRow[];
    uncertain: number;
    coverage: { total_pages: number; pages: CoveragePage[]; pages_awaiting: number[] };
}

const DETECTED_LABEL: Record<string, string> = {
    marked: 'Box marked',
    blank: 'Box blank',
    uncertain: 'Could not tell',
};

export default function ScanReviewPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data, error, loading, reload } = useResource<Review>(`/api/admin/attendance-scans/${id}`);

    const [marks, setMarks] = useState<Record<string, { status: Status; reason: string }>>({});
    const [uncertainFirst, setUncertainFirst] = useState(true);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [rereading, setRereading] = useState(false);

    useEffect(() => {
        if (!data)
            return;
        const initial: Record<string, { status: Status; reason: string }> = {};
        for (const row of data.rows)
            initial[row.member_id] = { status: row.proposed, reason: '' };
        setMarks(initial);
    }, [data]);

    useEffect(() => {
        if (!data?.scan.photo_available)
            return;
        let cancelled = false;
        api<{ url: string }>(`/api/admin/attendance-scans/${id}/photo-url`)
            .then((result) => { if (!cancelled) setPhotoUrl(result.url); })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [data?.scan.photo_available, id]);

    const ordered = useMemo(() => {
        if (!data)
            return [];
        const rows = [...data.rows];
        if (uncertainFirst) {
            rows.sort((a, b) => Number(b.uncertain) - Number(a.uncertain) || a.index - b.index);
        }
        return rows;
    }, [data, uncertainFirst]);

    const counts = useMemo(() => {
        const tally = { present: 0, absent: 0, apology: 0 };
        for (const mark of Object.values(marks))
            tally[mark.status] += 1;
        return tally;
    }, [marks]);

    const changed = useMemo(() => {
        if (!data)
            return 0;
        return data.rows.filter((row) => marks[row.member_id]?.status
            && marks[row.member_id]!.status !== row.proposed).length;
    }, [data, marks]);

    async function reread() {
        setRereading(true);
        setSaveError(null);
        try {
            await api(`/api/admin/attendance-scans/${id}/read`, { method: 'POST' });
            reload();
        }
        catch (err) {
            setSaveError(summariseError(err));
        }
        finally {
            setRereading(false);
        }
    }

    async function commit() {
        if (!data)
            return;
        setSaving(true);
        setSaveError(null);
        setSaved(null);
        try {
            const entries = data.rows.map((row) => {
                const mark = marks[row.member_id] ?? { status: row.proposed, reason: '' };
                return {
                    member_id: row.member_id,
                    status: mark.status,
                    reason: mark.status === 'apology' ? (mark.reason.trim() || null) : null,
                };
            });
            const result = await api<{
                created: number; updated: number; unchanged: number; overrides: number;
            }>(`/api/admin/attendance-scans/${id}/commit`, {
                method: 'PUT', body: JSON.stringify({ entries }),
            });
            setSaved(`Recorded. ${result.created} new, ${result.updated} changed, `
                + `${result.unchanged} unchanged, ${result.overrides} corrected by hand. `
                + 'Matrix scores read from this immediately.');
            reload();
        }
        catch (err) {
            setSaveError(summariseError(err));
        }
        finally {
            setSaving(false);
        }
    }

    if (loading)
        return <LoadingState label="Loading the sheet" />;
    if (error)
        return <ErrorState error={error} onRetry={reload} />;

    const review = data!;
    const committed = review.scan.status === 'committed';
    const rejected = review.scan.status === 'rejected';
    const unread = review.scan.status === 'uploaded' || review.scan.status === 'registered';
    const missing = review.coverage.pages_awaiting.filter((page) => page !== review.sheet.page_no);

    return (
        <>
            <p style={{ marginBottom: 'var(--space-4)' }}>
                <Link href="/admin/attendance-sheets" className="row small" style={{ textDecoration: 'none' }}>
                    <ArrowLeft size={15} aria-hidden="true" />
                    Back to attendance sheets
                </Link>
            </p>

            <PageHeader
                title={review.event?.title ?? 'Attendance sheet'}
                description={`${formatDate(review.event?.date ?? null)} - page ${review.sheet.page_no} of `
                    + `${review.sheet.total_pages}, sheet ${review.sheet.sheet_code}`}
                actions={review.event?.matrix_item_key
                    ? <Pill tone="navy">Feeds {matrixItemLabel(review.event.matrix_item_key)}</Pill>
                    : <Pill>Not scored</Pill>}
            />

            {saveError ? <p className={styles.error} role="alert">{saveError}</p> : null}
            {saved ? <p className={styles.notice} role="status">{saved}</p> : null}

            {rejected ? (
                <p className={styles.error} role="alert">
                    <AlertTriangle size={15} aria-hidden="true" />{' '}
                    <strong>This photograph was not read.</strong> {review.scan.reject_reason}{' '}
                    Photograph the page again, or record this register by hand from{' '}
                    <Link href={`/admin/events/${review.event?.id ?? ''}`}>the event screen</Link>.
                </p>
            ) : null}

            {unread ? (
                <p className={styles.error} role="status">
                    <AlertTriangle size={15} aria-hidden="true" />{' '}
                    <strong>This photograph is safely stored but has not been read yet.</strong>{' '}
                    The sheet reader could not be reached when it was uploaded. Use
                    &ldquo;Read this photograph again&rdquo; once it is back, or record this
                    register by hand from{' '}
                    <Link href={`/admin/events/${review.event?.id ?? ''}`}>the event screen</Link>.
                    Nothing below has been measured.
                </p>
            ) : null}

            {committed ? (
                <p className={styles.notice} role="status">
                    Recorded {formatDateTime(review.scan.committed_at)}
                    {review.scan.reviewed_by ? ` by ${review.scan.reviewed_by}` : ''}. Reading the
                    same sheet again would not record it twice.
                </p>
            ) : null}

            {missing.length > 0 ? (
                <p className={styles.error} role="status">
                    <AlertTriangle size={15} aria-hidden="true" />{' '}
                    This meeting was printed on {review.coverage.total_pages} pages, and{' '}
                    {missing.length === 1 ? `page ${missing[0]} has` : `pages ${missing.join(', ')} have`}{' '}
                    not been recorded yet. Everyone on{' '}
                    {missing.length === 1 ? 'that page' : 'those pages'} stays unmarked until{' '}
                    {missing.length === 1 ? 'it is' : 'they are'} photographed or entered by hand.
                </p>
            ) : null}

            <div className={styles.layout}>
                <div>
                    <div className={styles.toolbar}>
                        <div className="row" style={{ flexWrap: 'wrap' }}>
                            <label className="row small" style={{ gap: 'var(--space-2)' }}>
                                <input
                                    type="checkbox" checked={uncertainFirst}
                                    onChange={(event) => setUncertainFirst(event.target.checked)}
                                />
                                Put the doubtful rows first
                            </label>
                            {review.uncertain > 0
                                ? <Pill tone="accent">{review.uncertain} to check</Pill>
                                : <Pill>Every box was read clearly</Pill>}
                            {changed > 0 ? <Pill tone="navy">{changed} changed by you</Pill> : null}
                        </div>
                        <div className="row" style={{ flexWrap: 'wrap' }}>
                            <span className="pill pillPresent">{counts.present} present</span>
                            <span className="pill pillApology">{counts.apology} apology</span>
                            <span className="pill pillAbsent">{counts.absent} absent</span>
                            <button
                                type="button" className="btn btnPrimary"
                                onClick={commit} disabled={saving || committed || rejected || unread}
                            >
                                <Save size={15} aria-hidden="true" />
                                {saving ? 'Recording...'
                                    : committed ? 'Already recorded'
                                        : unread ? 'Not read yet'
                                            : 'Record this page'}
                            </button>
                        </div>
                    </div>

                    <section className="card">
                        <div className="tableScroll">
                            <table className="table">
                                <caption className="srOnly">
                                    Rows read from sheet {review.sheet.sheet_code}
                                </caption>
                                <thead>
                                    <tr>
                                        <th scope="col">No.</th>
                                        <th scope="col">Member</th>
                                        <th scope="col">What was read</th>
                                        <th scope="col">Attendance</th>
                                        <th scope="col">Reason (apology only)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordered.map((row) => {
                                        const mark = marks[row.member_id]
                                            ?? { status: row.proposed, reason: '' };
                                        return (
                                            <tr key={row.member_id} className={row.uncertain ? styles.uncertain : undefined}>
                                                <td data-label="No." className={styles.measure}>{row.serial}</td>
                                                <td data-label="Member">
                                                    {row.full_name}
                                                    <span className="subtle small" style={{ display: 'block' }}>
                                                        {row.prayer_house}
                                                        {row.recorded_status
                                                            ? ` - already recorded as ${row.recorded_status}`
                                                            : ''}
                                                    </span>
                                                </td>
                                                <td data-label="What was read" className={styles.measure}>
                                                    {row.detected_state
                                                        ? DETECTED_LABEL[row.detected_state]
                                                        : 'Not read'}
                                                    <span className="subtle small" style={{ display: 'block' }}>
                                                        {row.fill_ratio !== null
                                                            ? `${Math.round(row.fill_ratio * 100)}% of the box`
                                                            : 'no measurement'}
                                                        {row.confidence !== null
                                                            ? `, confidence ${Math.round(row.confidence * 100)}%`
                                                            : ''}
                                                    </span>
                                                </td>
                                                <td data-label="Attendance">
                                                    <fieldset className={styles.statusGroup} disabled={committed}>
                                                        <legend className="srOnly">
                                                            Attendance for {row.full_name}
                                                        </legend>
                                                        {(['present', 'apology', 'absent'] as Status[]).map((status) => (
                                                            <label key={status} className={styles.statusOption}>
                                                                <input
                                                                    type="radio"
                                                                    name={`status-${row.member_id}`}
                                                                    value={status}
                                                                    checked={mark.status === status}
                                                                    onChange={() => setMarks({
                                                                        ...marks,
                                                                        [row.member_id]: { ...mark, status },
                                                                    })}
                                                                />
                                                                <span>{status}</span>
                                                            </label>
                                                        ))}
                                                    </fieldset>
                                                </td>
                                                <td data-label="Reason (apology only)">
                                                    <label className="srOnly" htmlFor={`reason-${row.member_id}`}>
                                                        Reason for {row.full_name}
                                                    </label>
                                                    <input
                                                        id={`reason-${row.member_id}`}
                                                        className="input"
                                                        value={mark.reason}
                                                        disabled={mark.status !== 'apology' || committed}
                                                        placeholder={mark.status === 'apology' ? 'e.g. travelling' : ''}
                                                        onChange={(event) => setMarks({
                                                            ...marks,
                                                            [row.member_id]: { ...mark, reason: event.target.value },
                                                        })}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>

                <aside className={styles.aside}>
                    <section className="card">
                        <div className="cardHeader"><h2>The photograph</h2></div>
                        <div className="cardBody">
                            {photoUrl ? (
                                <a href={photoUrl} target="_blank" rel="noreferrer">
                                    <img
                                        className={styles.photo}
                                        src={photoUrl}
                                        alt={`The photographed attendance sheet, page ${review.sheet.page_no} of ${review.sheet.total_pages}`}
                                    />
                                </a>
                            ) : (
                                <p className="subtle small">
                                    {review.scan.photo_available
                                        ? 'Loading the photograph...'
                                        : 'The photograph has been purged. What was measured from it is still here.'}
                                </p>
                            )}
                            <p className="subtle small" style={{ marginTop: 'var(--space-3)' }}>
                                Uploaded {formatDateTime(review.scan.uploaded_at)}
                                {review.scan.uploaded_by ? ` by ${review.scan.uploaded_by}` : ''}.
                            </p>
                        </div>
                    </section>

                    <section className="card" style={{ marginTop: 'var(--space-4)' }}>
                        <div className="cardHeader"><h2>How it was read</h2></div>
                        <div className="cardBody">
                            <dl className="small">
                                <dt className="label">Sheet code on the page</dt>
                                <dd><code>{review.scan.registration?.pointer_read ?? review.sheet.sheet_code}</code></dd>
                                <dt className="label">Template</dt>
                                <dd>{review.sheet.template_version}</dd>
                                {review.scan.registration ? (
                                    <>
                                        <dt className="label">Alignment</dt>
                                        <dd>
                                            {Math.round(review.scan.registration.outline_ink * 100)}% of the
                                            printed boxes landed where they belong, corner marks{' '}
                                            {review.scan.registration.alignment_error_px}px out
                                            {review.scan.registration.rotated ? ', page was turned round' : ''}
                                        </dd>
                                    </>
                                ) : null}
                                {review.scan.quality ? (
                                    <>
                                        <dt className="label">Photograph</dt>
                                        <dd>
                                            sharpness {review.scan.quality.blur},
                                            brightness {review.scan.quality.brightness}
                                        </dd>
                                    </>
                                ) : null}
                                {review.scan.thresholds ? (
                                    <>
                                        <dt className="label">Thresholds used</dt>
                                        <dd>
                                            blank at or below {Math.round(review.scan.thresholds.low * 100)}%,
                                            marked at or above {Math.round(review.scan.thresholds.high * 100)}%
                                        </dd>
                                    </>
                                ) : null}
                            </dl>

                            {!committed && review.scan.photo_available ? (
                                <button
                                    type="button" className="btn btnSecondary"
                                    style={{ marginTop: 'var(--space-3)' }}
                                    onClick={reread} disabled={rereading}
                                >
                                    <RefreshCw size={15} aria-hidden="true" />
                                    {rereading ? 'Reading again...' : 'Read this photograph again'}
                                </button>
                            ) : null}
                        </div>
                    </section>

                    <section className="card" style={{ marginTop: 'var(--space-4)' }}>
                        <div className="cardHeader"><h2>Pages of this meeting</h2></div>
                        <div className="cardBody">
                            <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                {review.coverage.pages.map((page) => (
                                    <li key={page.sheet_id}>
                                        Page {page.page_no}, {page.rows} names
                                        {page.committed
                                            ? ' - recorded'
                                            : page.scans > 0
                                                ? ' - photographed, not yet recorded'
                                                : ' - not photographed'}
                                    </li>
                                ))}
                            </ul>
                            <p className="subtle small" style={{ marginTop: 'var(--space-3)' }}>
                                A page that never comes back can always be entered by hand from{' '}
                                <Link href={`/admin/events/${review.event?.id ?? ''}`}>the event register</Link>.
                            </p>
                        </div>
                    </section>
                </aside>
            </div>
        </>
    );
}
