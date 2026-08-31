import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, notFound } from '../util/errors.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { issueDocument } from '../documents/issue.js';
import { drawAttendanceSheet, type SheetPage, type SheetRow } from '../pdf/attendance-sheet.js';
import { newSheetCode, pointerFor } from './sheetCode.js';
import { BADGE_QUIET_MODULES, ROWS_PER_PAGE, TEMPLATE_VERSION } from './template.js';

/**
 * Phase 9a. Making the sheet.
 *
 * The rows are bound to members here, once, and stored as the manifest. From
 * this point the pipeline resolves a tick to a person through the manifest and
 * never through the printed name, so a smudged or misread name cannot put
 * attendance against the wrong member.
 *
 * Sheets are printed fresh for each meeting and never photocopied. A copy
 * loses the crispness of the registration marks and shifts the alignment, and
 * there is no reason to make one: generating again is a click, and it also
 * picks up anyone who joined since.
 */

/** Enough for the whole parish several times over, and a stop on a mistake. */
const MAX_PAGES = 40;

export interface GenerateSheetsRequest {
    /** An event already on the programme, or the makings of a new one. */
    eventId?: string | null;
    newEvent?: {
        type: string;
        subtype?: string | null;
        matrixItemKey?: string | null;
        title: string;
        date: string;
    } | null;
    /** One house, or null for parish-wide. */
    prayerHouseId?: string | null;
    /** Narrows the roll within the house. Empty means everyone. */
    memberIds?: string[] | null;
    generatedBy: string;
}

export interface GeneratedSheets {
    documentId: string;
    pdf: Buffer;
    generationId: string;
    eventId: string;
    eventTitle: string;
    eventDate: string;
    houseLabel: string;
    pages: Array<{ sheetId: string; sheetCode: string; pageNo: number; rows: number }>;
    members: number;
}

interface MemberRow {
    id: string;
    full_name: string;
    prayer_house: string;
}

interface EventRow {
    id: string;
    title: string;
    date: string;
    prayer_house_id: string | null;
}

async function resolveEvent(request: GenerateSheetsRequest, actor: AuditActor): Promise<EventRow> {
    if (request.eventId) {
        const event = await queryOne<EventRow>(
            `SELECT id, title, date::text, prayer_house_id FROM events WHERE id = $1`,
            [request.eventId]);
        if (!event)
            throw notFound('That event could not be found.');
        return event;
    }

    const draft = request.newEvent;
    if (!draft)
        throw badRequest('Choose an event, or give the meeting type and date for a new one.');

    return withTransaction(async (client) => {
        const created = await queryOne<EventRow>(
            `INSERT INTO events (type, subtype, matrix_item_key, title, date, prayer_house_id, created_by)
             VALUES ($1::event_type, $2, $3, $4, $5::date, $6, $7)
             RETURNING id, title, date::text, prayer_house_id`,
            [draft.type, draft.subtype ?? null, draft.matrixItemKey ?? null, draft.title,
                draft.date, request.prayerHouseId ?? null, request.generatedBy], client);
        await writeAudit(client, {
            entityType: 'event', entityId: created!.id, action: 'create',
            newValue: {
                title: draft.title, date: draft.date,
                matrix_item_key: draft.matrixItemKey ?? null, from: 'attendance-sheet',
            },
        }, actor);
        return created!;
    });
}

async function rollFor(prayerHouseId: string | null, memberIds: string[] | null): Promise<MemberRow[]> {
    const rows = await query<MemberRow>(
        `SELECT m.id, m.full_name, ph.name AS prayer_house
           FROM members m
           JOIN prayer_houses ph ON ph.id = m.prayer_house_id
          WHERE m.membership_status = 'active'
            AND ($1::uuid IS NULL OR m.prayer_house_id = $1)
            AND ($2::uuid[] IS NULL OR m.id = ANY($2))
          ORDER BY ph.name, m.full_name`,
        [prayerHouseId, memberIds && memberIds.length > 0 ? memberIds : null]);
    return rows.rows;
}

/**
 * A pointer QR, black on white rather than in the house navy. This one is read
 * by a camera under whatever light the church hall has, so it is given every
 * bit of contrast there is. The verification QR in the footer, which a phone
 * scans at leisure, keeps the house colour.
 */
async function pointerQr(code: string): Promise<Buffer> {
    return QRCode.toBuffer(pointerFor(code), {
        type: 'png',
        margin: BADGE_QUIET_MODULES,
        width: 480,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
    });
}

export async function generateSheets(
    request: GenerateSheetsRequest,
    actor: AuditActor,
): Promise<GeneratedSheets> {
    const config = await loadMatrixConfig();
    const event = await resolveEvent(request, actor);
    const houseId = request.prayerHouseId ?? event.prayer_house_id ?? null;

    const house = houseId
        ? await queryOne<{ name: string }>(`SELECT name FROM prayer_houses WHERE id = $1`, [houseId])
        : null;
    if (houseId && !house)
        throw notFound('That prayer house could not be found.');

    // An empty list is somebody having unticked every name, not somebody
    // asking for everyone. Say so rather than printing the whole house.
    if (request.memberIds && request.memberIds.length === 0)
        throw badRequest('No members were chosen, so there is nothing to print.');

    const roll = await rollFor(houseId, request.memberIds ?? null);
    if (roll.length === 0) {
        throw badRequest(houseId
            ? 'That prayer house has no active members to print.'
            : 'There are no active members to print.');
    }

    const totalPages = Math.ceil(roll.length / ROWS_PER_PAGE);
    if (totalPages > MAX_PAGES) {
        throw badRequest(
            `That would print ${totalPages} pages. Generate one prayer house at a time.`);
    }

    const generationId = randomUUID();
    const pages: SheetPage[] = [];
    const manifests: Array<{ code: string; memberIds: string[] }> = [];

    for (let page = 0; page < totalPages; page += 1) {
        const slice = roll.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
        const code = newSheetCode();
        manifests.push({ code, memberIds: slice.map((m) => m.id) });
        pages.push({
            sheetCode: code,
            pointerQr: await pointerQr(code),
            pageNo: page + 1,
            totalPages,
            rows: slice.map((member, index): SheetRow => ({
                serial: page * ROWS_PER_PAGE + index + 1,
                fullName: member.full_name,
                prayerHouse: member.prayer_house,
            })),
        });
    }

    const houseLabel = house ? `${house.name} prayer house` : 'All prayer houses';

    const issued = await issueDocument({
        kind: 'attendance_sheet',
        title: 'Attendance Sheet',
        orgName: config.org_name,
        subjectLabel: `${event.title}, ${houseLabel}`,
        metadata: {
            event: event.title,
            meeting_date: event.date,
            prayer_house: house?.name ?? 'parish-wide',
            members_listed: roll.length,
            pages: totalPages,
            template_version: TEMPLATE_VERSION,
        },
        issuedBy: request.generatedBy,
    }, (doc) => drawAttendanceSheet(doc, {
        orgName: config.org_name,
        eventTitle: event.title,
        eventDate: event.date,
        houseLabel,
        pages,
    }));

    const stored = await withTransaction(async (client) => {
        const created: GeneratedSheets['pages'] = [];
        for (const [index, page] of manifests.entries()) {
            const pageNo = index + 1;
            const row = await queryOne<{ id: string }>(
                `INSERT INTO attendance_sheets
                   (event_id, prayer_house_id, generation_id, page_no, total_pages,
                    sheet_code, template_version, row_manifest, document_id, generated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
                 RETURNING id`,
                [event.id, houseId, generationId, pageNo, totalPages,
                    page.code, TEMPLATE_VERSION, JSON.stringify(page.memberIds),
                    issued.documentId, request.generatedBy], client);
            await writeAudit(client, {
                entityType: 'attendance_sheet', entityId: row!.id, action: 'create',
                newValue: {
                    event_id: event.id, sheet_code: page.code,
                    page_no: pageNo, total_pages: totalPages,
                    members: page.memberIds.length, document_id: issued.documentId,
                },
            }, actor);
            created.push({
                sheetId: row!.id, sheetCode: page.code,
                pageNo, rows: page.memberIds.length,
            });
        }
        return created;
    });

    return {
        documentId: issued.documentId,
        pdf: issued.pdf,
        generationId,
        eventId: event.id,
        eventTitle: event.title,
        eventDate: event.date,
        houseLabel,
        pages: stored,
        members: roll.length,
    };
}
