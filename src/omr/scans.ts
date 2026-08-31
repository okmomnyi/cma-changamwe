import { createHash } from 'node:crypto';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { configNumber, loadMatrixConfig } from '../matrix/config.js';
import {
    deleteObject, fetchObjectBytes, isValidScanKey, newScanKey, photosConfigured,
    photosUnconfiguredReason, presignScanUpload, presignView, verifyUploadedScan,
} from '../media/r2.js';
import { detectSheet, omrConfigured, omrUnconfiguredReason, type CellState, type DetectionResult } from './detect.js';
import { DEFAULT_FILL_HIGH, DEFAULT_FILL_LOW, ROWS_PER_PAGE, templateDescriptor } from './template.js';
import type { AttendanceStatus } from '../../shared/vocabulary.js';

/**
 * Phase 9, steps 2 to 7: capture, register, detect, review, commit.
 *
 * Nothing here writes attendance on its own. The pipeline's job is to be right
 * about the easy majority and honest about the rest, and then to hand a person
 * a screen where the doubtful rows are already at the top. Because this data
 * decides who qualifies for welfare money, a photograph is never the last word.
 */

export interface ScanRow {
    id: string;
    sheet_id: string;
    photo_ref: string | null;
    photo_hash: string | null;
    byte_size: number | null;
    status: string;
    reject_reason: string | null;
    detection_json: DetectionRecord;
    uploaded_at: string;
    reviewed_at: string | null;
    committed_at: string | null;
    photo_purged_at: string | null;
}

export interface DetectionRecord {
    template_version?: string;
    thresholds?: { low: number; high: number };
    registration?: DetectionResult['registration'];
    quality?: DetectionResult['quality'];
    rows?: Array<{
        index: number;
        member_id: string;
        fill_ratio: number;
        state: CellState;
        confidence: number;
    }>;
    review?: {
        overrides: Array<{ index: number; member_id: string; from: string; to: string }>;
        committed: Array<{ member_id: string; status: string }>;
    };
}

interface SheetRecord {
    id: string;
    event_id: string;
    sheet_code: string;
    template_version: string;
    page_no: number;
    total_pages: number;
    generation_id: string;
    row_manifest: string[];
}

async function loadSheet(sheetId: string): Promise<SheetRecord> {
    const sheet = await queryOne<SheetRecord>(
        `SELECT id, event_id, sheet_code, template_version, page_no, total_pages,
                generation_id, row_manifest
           FROM attendance_sheets WHERE id = $1`, [sheetId]);
    if (!sheet)
        throw notFound('That sheet could not be found.');
    return sheet;
}

/** Thresholds live in configuration, so they can be calibrated on real
 *  photographs without a deployment. */
async function thresholds(): Promise<{ low: number; high: number }> {
    const config = await loadMatrixConfig();
    return {
        low: configNumber(config, 'omr_fill_low', DEFAULT_FILL_LOW),
        high: configNumber(config, 'omr_fill_high', DEFAULT_FILL_HIGH),
    };
}

export function assertScanningAvailable(): void {
    if (!photosConfigured)
        throw badRequest(photosUnconfiguredReason());
    if (!omrConfigured)
        throw badRequest(omrUnconfiguredReason());
}

/* -------------------------------------------------------------- capture -- */

export async function issueScanUploadKey(sheetId: string, issuedBy: string) {
    assertScanningAvailable();
    const sheet = await loadSheet(sheetId);
    const key = newScanKey(sheet.id);
    await query(
        `INSERT INTO photo_upload_grants (object_key, scope, owner_id, issued_by, expires_at)
         VALUES ($1, 'scans', $2, $3, now() + interval '1 hour')`,
        [key, sheet.id, issuedBy]);
    const signed = await presignScanUpload(key);
    return { ...signed, object_key: key, content_type: 'image/jpeg' };
}

async function claimUploadKey(objectKey: string, sheetId: string): Promise<void> {
    const claimed = await queryOne<{ object_key: string }>(
        `UPDATE photo_upload_grants SET consumed_at = now()
          WHERE object_key = $1 AND scope = 'scans' AND owner_id = $2
            AND consumed_at IS NULL AND expires_at > now()
          RETURNING object_key`, [objectKey, sheetId]);
    if (!claimed) {
        throw badRequest(
            'That upload has expired or was not issued for this sheet. Take the photograph again.');
    }
}

export interface ConfirmedScan {
    scanId: string;
    status: string;
    duplicateOf: string | null;
    rejectReason: string | null;
}

/**
 * Records the photograph, then reads it.
 *
 * The hash is taken before anything else, so the same photograph sent twice is
 * recognised as the same photograph rather than processed again. If the reader
 * is unreachable the scan stays as uploaded and can be read later: the image is
 * already safe, and nothing has been guessed at.
 */
export async function confirmScan(
    params: { sheetId: string; objectKey: string; uploadedBy: string },
    actor: AuditActor,
): Promise<ConfirmedScan> {
    assertScanningAvailable();
    if (!isValidScanKey(params.objectKey))
        throw badRequest('That is not an upload key issued by this server.');

    const sheet = await loadSheet(params.sheetId);
    await claimUploadKey(params.objectKey, sheet.id);
    const uploaded = await verifyUploadedScan(params.objectKey);

    const bytes = await fetchObjectBytes(params.objectKey);
    if (!bytes)
        throw badRequest('That photograph could not be read back from storage. Please try again.');
    const hash = createHash('sha256').update(bytes).digest('hex');

    const existing = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM attendance_scans WHERE sheet_id = $1 AND photo_hash = $2`,
        [sheet.id, hash]);
    if (existing) {
        // Not an error. The secretary photographed or uploaded the same image
        // twice; the first one already holds everything this one would.
        await deleteObject(params.objectKey);
        return {
            scanId: existing.id, status: existing.status,
            duplicateOf: existing.id, rejectReason: null,
        };
    }

    const scan = await withTransaction(async (client) => {
        const row = await queryOne<{ id: string }>(
            `INSERT INTO attendance_scans (sheet_id, photo_ref, photo_hash, byte_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [sheet.id, params.objectKey, hash, uploaded.byteSize, params.uploadedBy], client);
        await writeAudit(client, {
            entityType: 'attendance_scan', entityId: row!.id, action: 'create',
            newValue: {
                sheet_id: sheet.id, sheet_code: sheet.sheet_code,
                photo_hash: hash, byte_size: uploaded.byteSize,
            },
        }, actor);
        return row!.id;
    });

    // The photograph is stored and recorded before it is read. If the reader
    // is down, that is not a lost photograph and not an error the secretary
    // should have to act on with the sheet still in hand: the scan waits, and
    // can be read from the review screen once the reader is back.
    try {
        const outcome = await readScan(scan, actor);
        return {
            scanId: scan, status: outcome.status,
            duplicateOf: null, rejectReason: outcome.rejectReason,
        };
    }
    catch (err) {
        logger.error({ err, scanId: scan }, 'the photograph was stored but could not be read');
        return {
            scanId: scan,
            status: 'uploaded',
            duplicateOf: null,
            rejectReason: err instanceof Error ? err.message : 'The sheet reader could not be reached.',
        };
    }
}

/**
 * Registers and reads one stored photograph. Safe to run again: it only ever
 * replaces the measurements, and it refuses once the scan has been committed.
 */
export async function readScan(
    scanId: string,
    actor: AuditActor,
): Promise<{ status: string; rejectReason: string | null }> {
    const scan = await queryOne<ScanRow>(
        `SELECT id, sheet_id, photo_ref, status FROM attendance_scans WHERE id = $1`, [scanId]);
    if (!scan)
        throw notFound('That scan could not be found.');
    if (scan.status === 'committed')
        throw conflict('That sheet has already been committed, so it is not read again.');
    if (!scan.photo_ref)
        throw conflict('The photograph for that scan has been purged, so it cannot be read again.');

    const sheet = await loadSheet(scan.sheet_id);
    const bytes = await fetchObjectBytes(scan.photo_ref);
    if (!bytes)
        throw badRequest('That photograph could not be read back from storage.');

    const limits = await thresholds();
    const template = templateDescriptor(sheet.row_manifest.length, limits);
    const result = await detectSheet(bytes, sheet.sheet_code, template);

    // The pointer has to resolve to this sheet. A page photographed against
    // the wrong record would put one meeting's ticks onto another's roll.
    const mismatch = result.status === 'detected'
        && result.sheet_code !== null
        && result.sheet_code !== sheet.sheet_code;

    const rejected = result.status === 'rejected' || mismatch;
    const reason = mismatch
        ? `The code on that page reads ${result.sheet_code}, not ${sheet.sheet_code}. `
          + 'It belongs to a different sheet.'
        : result.reject_reason;

    const record: DetectionRecord = {
        template_version: result.template_version ?? sheet.template_version,
        thresholds: limits,
        registration: result.registration,
        quality: result.quality,
        rows: rejected ? [] : result.rows.flatMap((row) => {
            // A row the reader reports that the manifest does not have is a
            // reader fault, not attendance. Dropping it is safe: the review
            // screen works from the manifest and will show the gap.
            const memberId = sheet.row_manifest[row.index];
            if (memberId === undefined)
                return [];
            return [{
                index: row.index,
                member_id: memberId,
                fill_ratio: row.fill_ratio,
                state: row.state,
                confidence: row.confidence,
            }];
        }),
    };

    const status = rejected ? 'rejected' : 'detected';

    await withTransaction(async (client) => {
        await query(
            `UPDATE attendance_scans
                SET status = $2::attendance_scan_status,
                    reject_reason = $3,
                    detection_json = $4::jsonb
              WHERE id = $1`,
            [scanId, status, rejected ? (reason ?? 'The photograph could not be read.') : null,
                JSON.stringify(record)], client);
        await writeAudit(client, {
            entityType: 'attendance_scan', entityId: scanId, action: 'update',
            fieldChanged: 'status',
            oldValue: { status: scan.status },
            newValue: {
                status,
                reject_reason: rejected ? reason : null,
                rows_read: record.rows?.length ?? 0,
                uncertain: record.rows?.filter((r) => r.state === 'uncertain').length ?? 0,
            },
        }, actor);
    });

    if (rejected)
        logger.info({ scanId, reason }, 'attendance scan rejected');
    return { status, rejectReason: rejected ? (reason ?? null) : null };
}

/* --------------------------------------------------------------- review -- */

export interface ReviewRow {
    index: number;
    serial: number;
    member_id: string;
    full_name: string;
    prayer_house: string;
    detected_state: CellState | null;
    fill_ratio: number | null;
    confidence: number | null;
    /** What the pipeline proposes, before the secretary touches anything. */
    proposed: AttendanceStatus;
    uncertain: boolean;
    /** What is already recorded against this member for this event, if any. */
    recorded_status: AttendanceStatus | null;
    recorded_source: string | null;
}

/**
 * A blank box is an absence, a marked one is a presence, and a box the reader
 * could not call keeps whatever is already recorded, or waits as an absence.
 * Apology never comes off the paper: the sheet has one column by design, and
 * the secretary is the one who knows who sent word.
 */
function proposalFor(state: CellState | null, recorded: AttendanceStatus | null): AttendanceStatus {
    if (state === 'marked')
        return recorded === 'apology' ? 'apology' : 'present';
    if (state === 'blank')
        return recorded === 'apology' ? 'apology' : 'absent';
    return recorded ?? 'absent';
}

export async function scanReview(scanId: string) {
    const scan = await queryOne<ScanRow & { uploaded_by_name: string | null; reviewed_by_name: string | null }>(
        `SELECT s.id, s.sheet_id, s.photo_ref, s.photo_hash, s.byte_size, s.status,
                s.reject_reason, s.detection_json, s.uploaded_at::text,
                s.reviewed_at::text, s.committed_at::text, s.photo_purged_at::text,
                um.full_name AS uploaded_by_name, rm.full_name AS reviewed_by_name
           FROM attendance_scans s
           LEFT JOIN users uu ON uu.id = s.uploaded_by
           LEFT JOIN members um ON um.id = uu.member_id
           LEFT JOIN users ru ON ru.id = s.reviewed_by
           LEFT JOIN members rm ON rm.id = ru.member_id
          WHERE s.id = $1`, [scanId]);
    if (!scan)
        throw notFound('That scan could not be found.');

    const sheet = await queryOne<SheetRecord & { prayer_house: string | null }>(
        `SELECT sh.id, sh.event_id, sh.sheet_code, sh.template_version, sh.page_no,
                sh.total_pages, sh.generation_id, sh.row_manifest, ph.name AS prayer_house
           FROM attendance_sheets sh
           LEFT JOIN prayer_houses ph ON ph.id = sh.prayer_house_id
          WHERE sh.id = $1`, [scan.sheet_id]);
    if (!sheet)
        throw notFound('The sheet behind that scan could not be found.');

    const event = await queryOne<{
        id: string; title: string; date: string; type: string; matrix_item_key: string | null;
    }>(`SELECT id, title, date::text, type::text, matrix_item_key FROM events WHERE id = $1`,
        [sheet.event_id]);

    const manifest = sheet.row_manifest;
    const members = await query<{
        id: string; full_name: string; prayer_house: string;
        status: AttendanceStatus | null; source: string | null;
    }>(
        `SELECT m.id, m.full_name, ph.name AS prayer_house, a.status, a.source::text
           FROM members m
           JOIN prayer_houses ph ON ph.id = m.prayer_house_id
           LEFT JOIN attendance a ON a.member_id = m.id AND a.event_id = $2
          WHERE m.id = ANY($1::uuid[])`, [manifest, sheet.event_id]);
    const byId = new Map(members.rows.map((row) => [row.id, row]));

    const detection = scan.detection_json ?? {};
    const detected = new Map((detection.rows ?? []).map((row) => [row.index, row]));

    const rows: ReviewRow[] = manifest.map((memberId, index) => {
        const member = byId.get(memberId);
        const cell = detected.get(index);
        const recorded = member?.status ?? null;
        const state = cell?.state ?? null;
        return {
            index,
            // The number printed beside the name, which runs on across the
            // pages of the event rather than restarting on each.
            serial: (sheet.page_no - 1) * ROWS_PER_PAGE + index + 1,
            member_id: memberId,
            full_name: member?.full_name ?? 'Member no longer on the register',
            prayer_house: member?.prayer_house ?? '',
            detected_state: state,
            fill_ratio: cell?.fill_ratio ?? null,
            confidence: cell?.confidence ?? null,
            proposed: proposalFor(state, recorded),
            uncertain: state === 'uncertain' || state === null,
            recorded_status: recorded,
            recorded_source: member?.source ?? null,
        };
    });

    return {
        scan: {
            id: scan.id,
            status: scan.status,
            reject_reason: scan.reject_reason,
            uploaded_at: scan.uploaded_at,
            uploaded_by: scan.uploaded_by_name,
            reviewed_at: scan.reviewed_at,
            reviewed_by: scan.reviewed_by_name,
            committed_at: scan.committed_at,
            photo_available: Boolean(scan.photo_ref) && scan.photo_purged_at === null,
            quality: detection.quality ?? null,
            registration: detection.registration ?? null,
            thresholds: detection.thresholds ?? null,
        },
        sheet: {
            id: sheet.id,
            sheet_code: sheet.sheet_code,
            page_no: sheet.page_no,
            total_pages: sheet.total_pages,
            template_version: sheet.template_version,
            prayer_house: sheet.prayer_house,
        },
        event,
        rows,
        uncertain: rows.filter((r) => r.uncertain).length,
        coverage: await coverageFor(sheet.generation_id),
    };
}

/* ------------------------------------------------------------- coverage -- */

export interface CoveragePage {
    sheet_id: string;
    sheet_code: string;
    page_no: number;
    rows: number;
    scans: number;
    committed: boolean;
}

/**
 * Which pages of one printing run have been photographed, and which have not.
 * A parish-wide Dominica runs to a dozen sheets, and the one that never made
 * it back from the hall is the one nobody notices.
 */
export async function coverageFor(generationId: string) {
    const pages = await query<CoveragePage>(
        `SELECT sh.id AS sheet_id, sh.sheet_code, sh.page_no,
                jsonb_array_length(sh.row_manifest) AS rows,
                (SELECT count(*) FROM attendance_scans s
                  WHERE s.sheet_id = sh.id AND s.status <> 'rejected')::int AS scans,
                EXISTS (SELECT 1 FROM attendance_scans s
                         WHERE s.sheet_id = sh.id AND s.status = 'committed') AS committed
           FROM attendance_sheets sh
          WHERE sh.generation_id = $1
          ORDER BY sh.page_no`, [generationId]);
    const missing = pages.rows.filter((page) => !page.committed).map((page) => page.page_no);
    return {
        generation_id: generationId,
        total_pages: pages.rows.length,
        pages: pages.rows,
        pages_awaiting: missing,
    };
}

/* --------------------------------------------------------------- commit -- */

export interface CommitEntry {
    member_id: string;
    status: AttendanceStatus;
    reason?: string | null;
}

export interface CommitSummary {
    created: number;
    updated: number;
    unchanged: number;
    overrides: number;
}

/**
 * The only place OMR writes attendance, and it writes it the same way the
 * manual register does: one transaction holding the attendance rows and the
 * audit entries together, upserted on (member, event) so the same sheet read
 * twice records once.
 *
 * What separates it is the provenance. Every row it writes is marked as having
 * come off a sheet and points at the scan, which points at the photograph, the
 * measurements, and whoever confirmed them.
 */
export async function commitScan(
    scanId: string,
    entries: CommitEntry[],
    reviewerId: string,
    actor: AuditActor,
): Promise<CommitSummary> {
    return withTransaction(async (client) => {
        const scan = await queryOne<{ id: string; sheet_id: string; status: string; detection_json: DetectionRecord }>(
            `SELECT id, sheet_id, status, detection_json FROM attendance_scans
              WHERE id = $1 FOR UPDATE`, [scanId], client);
        if (!scan)
            throw notFound('That scan could not be found.');
        if (scan.status === 'committed')
            throw conflict('That sheet has already been committed. Nothing was recorded twice.');
        if (scan.status === 'rejected')
            throw conflict('That photograph was rejected, so it cannot be committed. Take it again, or enter the register by hand.');

        const sheet = await queryOne<SheetRecord>(
            `SELECT id, event_id, sheet_code, template_version, page_no, total_pages,
                    generation_id, row_manifest
               FROM attendance_sheets WHERE id = $1`, [scan.sheet_id], client);
        if (!sheet)
            throw notFound('The sheet behind that scan could not be found.');

        const manifest = new Set(sheet.row_manifest);
        for (const entry of entries) {
            if (!manifest.has(entry.member_id)) {
                throw badRequest(
                    'That register contains a member who is not on this sheet. Reload the review screen.');
            }
        }
        if (entries.length === 0)
            throw badRequest('There is nothing to commit.');

        const before = await query<{ member_id: string; status: string; reason: string | null; source: string }>(
            `SELECT member_id, status, reason, source::text FROM attendance
              WHERE event_id = $1 AND member_id = ANY($2::uuid[])`,
            [sheet.event_id, sheet.row_manifest], client);
        const previous = new Map(before.rows.map((row) => [row.member_id, row]));

        await query(
            `INSERT INTO attendance (member_id, event_id, status, reason, recorded_by, source, scan_id)
             SELECT e.member_id, $2, e.status::attendance_status, e.reason, $5, 'omr', $6
               FROM unnest($1::uuid[], $3::text[], $4::text[]) AS e(member_id, status, reason)
             ON CONFLICT (member_id, event_id) DO UPDATE
               SET status = EXCLUDED.status,
                   reason = EXCLUDED.reason,
                   recorded_by = EXCLUDED.recorded_by,
                   source = EXCLUDED.source,
                   scan_id = EXCLUDED.scan_id,
                   updated_at = now()`,
            [entries.map((e) => e.member_id), sheet.event_id,
                entries.map((e) => e.status), entries.map((e) => e.reason ?? null),
                reviewerId, scanId], client);

        let created = 0;
        let updated = 0;
        for (const entry of entries) {
            const was = previous.get(entry.member_id);
            if (!was) {
                created += 1;
                await writeAudit(client, {
                    entityType: 'attendance', entityId: null, action: 'create',
                    newValue: {
                        member_id: entry.member_id, event_id: sheet.event_id,
                        status: entry.status, reason: entry.reason ?? null,
                        source: 'omr', scan_id: scanId, sheet_code: sheet.sheet_code,
                    },
                }, actor);
            }
            else if (was.status !== entry.status
                || (was.reason ?? null) !== (entry.reason ?? null)
                || was.source !== 'omr') {
                updated += 1;
                await writeAudit(client, {
                    entityType: 'attendance', entityId: null, action: 'update',
                    fieldChanged: 'status',
                    oldValue: {
                        member_id: entry.member_id, event_id: sheet.event_id,
                        status: was.status, reason: was.reason, source: was.source,
                    },
                    newValue: {
                        member_id: entry.member_id, event_id: sheet.event_id,
                        status: entry.status, reason: entry.reason ?? null,
                        source: 'omr', scan_id: scanId, sheet_code: sheet.sheet_code,
                    },
                }, actor);
            }
        }

        // What the person changed against what the machine proposed. Kept on
        // the scan so a later calibration can be judged on real corrections
        // rather than on impressions.
        const detection = scan.detection_json ?? {};
        const byIndex = new Map((detection.rows ?? []).map((row) => [row.member_id, row]));
        const decided = new Map(entries.map((entry) => [entry.member_id, entry.status]));
        const overrides: NonNullable<DetectionRecord['review']>['overrides'] = [];
        sheet.row_manifest.forEach((memberId, index) => {
            const cell = byIndex.get(memberId);
            const chosen = decided.get(memberId);
            if (!chosen)
                return;
            const proposed = proposalFor(cell?.state ?? null, previous.get(memberId)?.status as AttendanceStatus ?? null);
            if (proposed !== chosen) {
                overrides.push({
                    index, member_id: memberId, from: proposed, to: chosen,
                });
            }
        });

        const record: DetectionRecord = {
            ...detection,
            review: {
                overrides,
                committed: entries.map((entry) => ({ member_id: entry.member_id, status: entry.status })),
            },
        };

        await query(
            `UPDATE attendance_scans
                SET status = 'committed', reviewed_by = $2, reviewed_at = now(),
                    committed_at = now(), detection_json = $3::jsonb
              WHERE id = $1`, [scanId, reviewerId, JSON.stringify(record)], client);

        await writeAudit(client, {
            entityType: 'attendance_scan', entityId: scanId, action: 'update',
            fieldChanged: 'status',
            oldValue: { status: scan.status },
            newValue: {
                status: 'committed', event_id: sheet.event_id, sheet_code: sheet.sheet_code,
                rows: entries.length, created, updated, overrides: overrides.length,
            },
        }, actor);

        // Live scores are recomputed from current records on every read and are
        // never cached, so committing here is the whole of the recalculation.
        return {
            created, updated,
            unchanged: entries.length - created - updated,
            overrides: overrides.length,
        };
    });
}

/* ---------------------------------------------------------------- photo -- */

export async function scanPhotoUrl(scanId: string) {
    const scan = await queryOne<{ photo_ref: string | null; photo_purged_at: string | null }>(
        `SELECT photo_ref, photo_purged_at::text FROM attendance_scans WHERE id = $1`, [scanId]);
    if (!scan)
        throw notFound('That scan could not be found.');
    if (!scan.photo_ref) {
        throw notFound(scan.photo_purged_at
            ? 'That photograph has been purged. The measurements taken from it are still on file.'
            : 'There is no photograph on file for that scan.');
    }
    if (!photosConfigured)
        throw badRequest(photosUnconfiguredReason());
    return presignView(scan.photo_ref);
}
