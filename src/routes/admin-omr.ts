import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../util/errors.js';
import type { AuditActor } from '../audit/audit.js';
import { EVENT_TYPES as EVENT_TYPE_VOCAB, valuesOf } from '../../shared/vocabulary.js';
import { generateSheets } from '../omr/generate.js';
import {
    commitScan, confirmScan, coverageFor, issueScanUploadKey, readScan,
    scanPhotoUrl, scanReview,
} from '../omr/scans.js';
import { omrConfigured, omrUnconfiguredReason } from '../omr/detect.js';
import { photosConfigured, photosUnconfiguredReason } from '../media/r2.js';
import { ROWS_PER_PAGE, TEMPLATE_VERSION } from '../omr/template.js';

/**
 * Phase 9. Every route here is administrative, and the router is mounted
 * behind the same office-derived check as the rest of the admin surface: the
 * photographs carry member names, and the ticks decide welfare eligibility.
 */
export const adminOmrRouter = Router();

const EVENT_TYPES = valuesOf(EVENT_TYPE_VOCAB);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();

function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}

function sendPdf(res: Response, pdf: Buffer, name: string, documentId: string): void {
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('content-length', String(pdf.length));
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-document-id', documentId);
    res.end(pdf);
}

function sheetFilename(eventTitle: string, date: string): string {
    const stem = eventTitle.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `attendance-sheet-${stem || 'meeting'}-${date}.pdf`;
}

/**
 * Whether the OMR path can be used at all, so the interface can offer manual
 * entry plainly rather than presenting a button that cannot work.
 */
adminOmrRouter.get('/attendance-omr/status', (_req, res) => {
    const reasons: string[] = [];
    if (!photosConfigured)
        reasons.push(photosUnconfiguredReason());
    if (!omrConfigured)
        reasons.push(omrUnconfiguredReason());
    res.json({
        available: photosConfigured && omrConfigured,
        storage_configured: photosConfigured,
        reader_configured: omrConfigured,
        reasons,
        template_version: TEMPLATE_VERSION,
        rows_per_page: ROWS_PER_PAGE,
    });
});

/* ---------------------------------------------------------- 9a: generate -- */

const generateSchema = z.object({
    event_id: uuid.nullish(),
    meeting: z.object({
        type: z.enum(EVENT_TYPES),
        subtype: z.string().trim().max(40).nullish(),
        matrix_item_key: z.string().trim().max(50).nullish(),
        title: z.string().trim().min(3).max(90),
        date: isoDate,
    }).nullish(),
    prayer_house_id: uuid.nullish(),
    member_ids: z.array(uuid).max(2000).nullish(),
});

/**
 * Renders the sheet and hands it straight back for printing. The pages, their
 * codes and the roll each one carries are recorded first, so the run can be
 * traced afterwards even though the PDF itself is never stored.
 */
adminOmrRouter.post('/attendance-sheets', reportDownloadLimiter, async (req, res, next) => {
    try {
        const body = generateSchema.parse(req.body);
        const result = await generateSheets({
            eventId: body.event_id ?? null,
            newEvent: body.meeting
                ? {
                    type: body.meeting.type,
                    subtype: body.meeting.subtype ?? null,
                    matrixItemKey: body.meeting.matrix_item_key ?? null,
                    title: body.meeting.title,
                    date: body.meeting.date,
                }
                : null,
            prayerHouseId: body.prayer_house_id ?? null,
            memberIds: body.member_ids ?? null,
            generatedBy: principalOf(req).userId,
        }, actorFor(req, 'attendance-sheet-generate'));

        res.setHeader('x-generation-id', result.generationId);
        res.setHeader('x-event-id', result.eventId);
        res.setHeader('x-pages', String(result.pages.length));
        sendPdf(res, result.pdf, sheetFilename(result.eventTitle, result.eventDate), result.documentId);
    }
    catch (err) {
        next(err);
    }
});

/**
 * A torn or lost page is reprinted, never photocopied. The roll is taken from
 * the run that was printed before, so the same members appear in the same
 * order, but the pages are a new run with new codes: what came back from the
 * hall and what was printed again stay tellable apart.
 */
adminOmrRouter.post('/attendance-sheets/:generationId/reprint', reportDownloadLimiter, async (req, res, next) => {
    try {
        const generationId = uuid.parse(req.params.generationId);
        const run = await query<{ event_id: string; prayer_house_id: string | null; row_manifest: string[] }>(
            `SELECT event_id, prayer_house_id, row_manifest FROM attendance_sheets
              WHERE generation_id = $1 ORDER BY page_no`, [generationId]);
        const first = run.rows[0];
        if (!first)
            throw notFound('That printing run could not be found.');

        const result = await generateSheets({
            eventId: first.event_id,
            prayerHouseId: first.prayer_house_id,
            memberIds: run.rows.flatMap((page) => page.row_manifest),
            generatedBy: principalOf(req).userId,
        }, actorFor(req, 'attendance-sheet-reprint'));

        res.setHeader('x-generation-id', result.generationId);
        res.setHeader('x-pages', String(result.pages.length));
        sendPdf(res, result.pdf, sheetFilename(result.eventTitle, result.eventDate), result.documentId);
    }
    catch (err) {
        next(err);
    }
});

const listSchema = z.object({
    event_id: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

adminOmrRouter.get('/attendance-sheets', async (req, res, next) => {
    try {
        const { event_id, limit, offset } = listSchema.parse(req.query);
        const rows = await query(
            `SELECT sh.id, sh.sheet_code, sh.page_no, sh.total_pages, sh.generation_id,
                    sh.template_version, sh.document_id, sh.generated_at,
                    jsonb_array_length(sh.row_manifest) AS members,
                    e.id AS event_id, e.title AS event_title, e.date AS event_date,
                    e.matrix_item_key, ph.name AS prayer_house,
                    m.full_name AS generated_by,
                    (SELECT count(*) FROM attendance_scans s WHERE s.sheet_id = sh.id)::int AS scans,
                    (SELECT count(*) FROM attendance_scans s
                      WHERE s.sheet_id = sh.id AND s.status = 'committed')::int AS committed_scans,
                    (SELECT count(*) FROM attendance_scans s
                      WHERE s.sheet_id = sh.id AND s.status = 'detected')::int AS awaiting_review,
                    (SELECT s.id FROM attendance_scans s
                      WHERE s.sheet_id = sh.id
                      ORDER BY s.uploaded_at DESC LIMIT 1) AS latest_scan_id
               FROM attendance_sheets sh
               JOIN events e ON e.id = sh.event_id
               LEFT JOIN prayer_houses ph ON ph.id = sh.prayer_house_id
               LEFT JOIN users u ON u.id = sh.generated_by
               LEFT JOIN members m ON m.id = u.member_id
              WHERE ($1::uuid IS NULL OR sh.event_id = $1)
              ORDER BY sh.generated_at DESC, sh.page_no
              LIMIT $2 OFFSET $3`,
            [event_id ?? null, limit, offset]);
        const total = await queryOne<{ n: string }>(
            `SELECT count(*)::text AS n FROM attendance_sheets
              WHERE ($1::uuid IS NULL OR event_id = $1)`, [event_id ?? null]);
        res.json({ sheets: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});

adminOmrRouter.get('/events/:id/sheet-coverage', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        const latest = await queryOne<{ generation_id: string }>(
            `SELECT generation_id FROM attendance_sheets
              WHERE event_id = $1 ORDER BY generated_at DESC LIMIT 1`, [id]);
        if (!latest) {
            res.json({ generation_id: null, total_pages: 0, pages: [], pages_awaiting: [] });
            return;
        }
        res.json(await coverageFor(latest.generation_id));
    }
    catch (err) {
        next(err);
    }
});

/* ------------------------------------------------- 9b: capture and read -- */

adminOmrRouter.post('/attendance-sheets/:id/scan/upload-url', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        res.json(await issueScanUploadKey(id, principalOf(req).userId));
    }
    catch (err) {
        next(err);
    }
});

const confirmSchema = z.object({ object_key: z.string().min(8).max(200) });

adminOmrRouter.post('/attendance-sheets/:id/scan/confirm', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        const { object_key } = confirmSchema.parse(req.body);
        const result = await confirmScan({
            sheetId: id, objectKey: object_key, uploadedBy: principalOf(req).userId,
        }, actorFor(req, 'attendance-scan-upload'));
        res.status(201).json({
            scan_id: result.scanId,
            status: result.status,
            duplicate_of: result.duplicateOf,
            reject_reason: result.rejectReason,
        });
    }
    catch (err) {
        next(err);
    }
});

/** Reads a photograph already on file again, after a threshold change or once
 *  the reader is back up. It never touches attendance. */
adminOmrRouter.post('/attendance-scans/:id/read', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        const result = await readScan(id, actorFor(req, 'attendance-scan-read'));
        res.json({ status: result.status, reject_reason: result.rejectReason });
    }
    catch (err) {
        next(err);
    }
});

const scanListSchema = z.object({
    status: z.enum(['uploaded', 'registered', 'detected', 'reviewed', 'committed', 'rejected']).optional(),
    event_id: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

adminOmrRouter.get('/attendance-scans', async (req, res, next) => {
    try {
        const { status, event_id, limit, offset } = scanListSchema.parse(req.query);
        const rows = await query(
            `SELECT s.id, s.status, s.reject_reason, s.uploaded_at, s.committed_at,
                    s.photo_purged_at,
                    sh.id AS sheet_id, sh.sheet_code, sh.page_no, sh.total_pages,
                    e.id AS event_id, e.title AS event_title, e.date AS event_date,
                    ph.name AS prayer_house,
                    m.full_name AS uploaded_by,
                    jsonb_array_length(COALESCE(s.detection_json -> 'rows', '[]'::jsonb)) AS rows_read,
                    (SELECT count(*) FROM jsonb_array_elements(
                        COALESCE(s.detection_json -> 'rows', '[]'::jsonb)) cell
                      WHERE cell ->> 'state' = 'uncertain')::int AS uncertain
               FROM attendance_scans s
               JOIN attendance_sheets sh ON sh.id = s.sheet_id
               JOIN events e ON e.id = sh.event_id
               LEFT JOIN prayer_houses ph ON ph.id = sh.prayer_house_id
               LEFT JOIN users u ON u.id = s.uploaded_by
               LEFT JOIN members m ON m.id = u.member_id
              WHERE ($1::attendance_scan_status IS NULL OR s.status = $1)
                AND ($2::uuid IS NULL OR sh.event_id = $2)
              ORDER BY s.uploaded_at DESC
              LIMIT $3 OFFSET $4`,
            [status ?? null, event_id ?? null, limit, offset]);
        const total = await queryOne<{ n: string }>(
            `SELECT count(*)::text AS n FROM attendance_scans s
               JOIN attendance_sheets sh ON sh.id = s.sheet_id
              WHERE ($1::attendance_scan_status IS NULL OR s.status = $1)
                AND ($2::uuid IS NULL OR sh.event_id = $2)`,
            [status ?? null, event_id ?? null]);
        res.json({ scans: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});

/* ------------------------------------------------ 9c: review and commit -- */

adminOmrRouter.get('/attendance-scans/:id', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        res.json(await scanReview(id));
    }
    catch (err) {
        next(err);
    }
});

adminOmrRouter.get('/attendance-scans/:id/photo-url', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        res.json(await scanPhotoUrl(id));
    }
    catch (err) {
        next(err);
    }
});

const commitSchema = z.object({
    entries: z.array(z.object({
        member_id: uuid,
        status: z.enum(['present', 'absent', 'apology']),
        reason: z.string().trim().max(200).nullish(),
    })).min(1).max(200),
});

adminOmrRouter.put('/attendance-scans/:id/commit', async (req, res, next) => {
    try {
        const id = uuid.parse(req.params.id);
        const { entries } = commitSchema.parse(req.body);
        const summary = await commitScan(
            id,
            entries.map((entry) => ({
                member_id: entry.member_id,
                status: entry.status,
                reason: entry.reason ?? null,
            })),
            principalOf(req).userId,
            actorFor(req, 'attendance-scan-commit'));
        res.json({ status: 'committed', ...summary });
    }
    catch (err) {
        next(err);
    }
});
