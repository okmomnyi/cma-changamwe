'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Plus } from 'lucide-react';
import { useResource } from '@/lib/useResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill } from '@/components/ui';
import { formatDate, formatDateTime, matrixItemLabel } from '@/lib/format';
import { GenerateSheetForm } from '@/components/GenerateSheetForm';
import { SheetScanUpload } from '@/components/SheetScanUpload';

interface SheetRow {
    id: string;
    sheet_code: string;
    page_no: number;
    total_pages: number;
    generation_id: string;
    document_id: string | null;
    generated_at: string;
    generated_by: string | null;
    members: number;
    event_id: string;
    event_title: string;
    event_date: string;
    matrix_item_key: string | null;
    prayer_house: string | null;
    scans: number;
    committed_scans: number;
    awaiting_review: number;
    latest_scan_id: string | null;
}

interface ScanRow {
    id: string;
    status: string;
    reject_reason: string | null;
    uploaded_at: string;
    uploaded_by: string | null;
    sheet_code: string;
    page_no: number;
    total_pages: number;
    event_title: string;
    event_date: string;
    rows_read: number;
    uncertain: number;
}

interface OmrStatus {
    available: boolean;
    storage_configured: boolean;
    reader_configured: boolean;
    reasons: string[];
}

const PAGE_SIZE = 60;

export default function AttendanceSheetsPage() {
    const [generating, setGenerating] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const status = useResource<OmrStatus>('/api/admin/attendance-omr/status');
    const sheets = useResource<{ sheets: SheetRow[]; total: number }>(
        `/api/admin/attendance-sheets?limit=${PAGE_SIZE}`);
    const waiting = useResource<{ scans: ScanRow[] }>(
        '/api/admin/attendance-scans?status=detected&limit=25');

    const runs = new Map<string, SheetRow[]>();
    for (const sheet of sheets.data?.sheets ?? []) {
        const pages = runs.get(sheet.generation_id) ?? [];
        pages.push(sheet);
        runs.set(sheet.generation_id, pages);
    }

    return (
        <>
            <PageHeader
                title="Attendance sheets"
                description="Print the roll, tick it at the meeting, photograph it, then check what was read before anything is recorded."
                actions={(
                    <button
                        type="button" className="btn btnPrimary"
                        onClick={() => setGenerating((open) => !open)} aria-expanded={generating}
                    >
                        <Plus size={15} aria-hidden="true" />
                        {generating ? 'Close' : 'Generate sheets'}
                    </button>
                )}
            />

            {status.data && !status.data.available ? (
                <p className="card" role="status" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
                    <AlertTriangle size={15} aria-hidden="true" />{' '}
                    <strong>Reading sheets is not switched on here.</strong>{' '}
                    {status.data.reasons.join(' ')}{' '}
                    Attendance can still be recorded in full from each event&apos;s register.
                </p>
            ) : null}

            {notice ? (
                <p className="card" role="status" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
                    {notice}
                </p>
            ) : null}

            {generating ? (
                <section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-label="Generate attendance sheets">
                    <div className="cardHeader"><h2>Generate sheets</h2></div>
                    <div className="cardBody">
                        <GenerateSheetForm onGenerated={() => { sheets.reload(); }} />
                    </div>
                </section>
            ) : null}

            <section className="card" style={{ marginBottom: 'var(--space-5)' }}>
                <div className="cardHeader">
                    <h2>Waiting to be checked</h2>
                    {waiting.data ? <span className="subtle small">{waiting.data.scans.length} sheets read</span> : null}
                </div>

                {waiting.loading ? <LoadingState label="Loading sheets read" /> : null}
                {waiting.error ? <ErrorState error={waiting.error} onRetry={waiting.reload} /> : null}
                {waiting.data && waiting.data.scans.length === 0 ? (
                    <EmptyState
                        title="Nothing waiting"
                        description="A photographed sheet appears here once it has been read, for checking before it is recorded."
                    />
                ) : null}

                {waiting.data && waiting.data.scans.length > 0 ? (
                    <div className="tableScroll">
                        <table className="table">
                            <caption className="srOnly">Sheets read and awaiting review</caption>
                            <thead>
                                <tr>
                                    <th scope="col">Meeting</th>
                                    <th scope="col">Page</th>
                                    <th scope="col">Rows read</th>
                                    <th scope="col">Uncertain</th>
                                    <th scope="col">Photographed</th>
                                    <th scope="col"><span className="srOnly">Review</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {waiting.data.scans.map((scan) => (
                                    <tr key={scan.id}>
                                        <td data-label="Meeting">
                                            {scan.event_title}
                                            <span className="subtle small" style={{ display: 'block' }}>
                                                {formatDate(scan.event_date)}
                                            </span>
                                        </td>
                                        <td data-label="Page" className="muted">
                                            {scan.page_no} of {scan.total_pages}
                                            <span className="subtle small" style={{ display: 'block' }}>
                                                {scan.sheet_code}
                                            </span>
                                        </td>
                                        <td data-label="Rows read">{scan.rows_read}</td>
                                        <td data-label="Uncertain">
                                            {scan.uncertain > 0
                                                ? <Pill tone="accent">{scan.uncertain} to check</Pill>
                                                : <span className="subtle">none</span>}
                                        </td>
                                        <td data-label="Photographed" className="muted small">
                                            {formatDateTime(scan.uploaded_at)}
                                            {scan.uploaded_by ? ` by ${scan.uploaded_by}` : ''}
                                        </td>
                                        <td data-label="Review">
                                            <Link className="btn btnPrimary" href={`/admin/attendance-scans/${scan.id}`}>
                                                Check and record
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
            </section>

            <section className="card">
                <div className="cardHeader">
                    <h2>Sheets printed</h2>
                    {sheets.data ? <span className="subtle small">{sheets.data.total} pages</span> : null}
                </div>

                {sheets.loading ? <LoadingState label="Loading sheets" /> : null}
                {sheets.error ? <ErrorState error={sheets.error} onRetry={sheets.reload} /> : null}
                {sheets.data && sheets.data.sheets.length === 0 ? (
                    <EmptyState
                        title="No sheets printed yet"
                        description="Use Generate sheets to print the roll for a meeting."
                    />
                ) : null}

                {[...runs.entries()].map(([generationId, pages]) => {
                    const first = pages[0]!;
                    const outstanding = pages.filter((page) => page.committed_scans === 0);
                    return (
                        <div key={generationId} className="cardBody" style={{ borderTop: '1px solid var(--hairline)' }}>
                            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                <div>
                                    <h3 style={{ margin: 0 }}>{first.event_title}</h3>
                                    <p className="subtle small" style={{ margin: 0 }}>
                                        {formatDate(first.event_date)}
                                        {' - '}{first.prayer_house ?? 'All prayer houses'}
                                        {' - '}{pages.length} page{pages.length === 1 ? '' : 's'}
                                        {' - printed '}{formatDateTime(first.generated_at)}
                                        {first.generated_by ? ` by ${first.generated_by}` : ''}
                                    </p>
                                </div>
                                <div className="row">
                                    {first.matrix_item_key
                                        ? <Pill tone="navy">Feeds {matrixItemLabel(first.matrix_item_key)}</Pill>
                                        : <Pill>Not scored</Pill>}
                                    {outstanding.length > 0
                                        ? <Pill tone="accent">{outstanding.length} page{outstanding.length === 1 ? '' : 's'} not yet recorded</Pill>
                                        : <Pill>All pages recorded</Pill>}
                                    <Link className="btn btnGhost" href={`/admin/events/${first.event_id}`}>
                                        Enter by hand instead
                                    </Link>
                                </div>
                            </div>

                            <div className="tableScroll" style={{ marginTop: 'var(--space-3)' }}>
                                <table className="table">
                                    <caption className="srOnly">Pages of {first.event_title}</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col">Page</th>
                                            <th scope="col">Sheet code</th>
                                            <th scope="col">Names</th>
                                            <th scope="col">Photographs</th>
                                            <th scope="col"><span className="srOnly">Photograph</span></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pages.map((page) => (
                                            <tr key={page.id}>
                                                <td data-label="Page">{page.page_no} of {page.total_pages}</td>
                                                <td data-label="Sheet code"><code>{page.sheet_code}</code></td>
                                                <td data-label="Names" className="muted">{page.members}</td>
                                                <td data-label="Photographs">
                                                    {page.latest_scan_id ? (
                                                        <Link href={`/admin/attendance-scans/${page.latest_scan_id}`}>
                                                            {page.committed_scans > 0
                                                                ? <Pill tone="navy">Recorded</Pill>
                                                                : page.awaiting_review > 0
                                                                    ? <Pill tone="accent">Read, waiting to be checked</Pill>
                                                                    : <Pill>Uploaded, not yet read</Pill>}
                                                        </Link>
                                                    ) : <span className="subtle">None yet</span>}
                                                </td>
                                                <td data-label="Photograph">
                                                    {status.data?.available ? (
                                                        <SheetScanUpload
                                                            sheetId={page.id}
                                                            sheetCode={page.sheet_code}
                                                            onUploaded={(scanId, scanStatus, duplicateOf) => {
                                                                sheets.reload();
                                                                waiting.reload();
                                                                setNotice(duplicateOf
                                                                    ? 'That photograph had already been uploaded, so nothing was read twice.'
                                                                    : null);
                                                                // Whatever happened, the answer is on that
                                                                // page: the rows to check, the reason it was
                                                                // refused, or the button to read it again.
                                                                window.location.assign(`/admin/attendance-scans/${scanId}`);
                                                                void scanStatus;
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="subtle small">Reading sheets is switched off</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </section>
        </>
    );
}
