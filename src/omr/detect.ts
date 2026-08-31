import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { AppError } from '../util/errors.js';
import type { TemplateDescriptor } from './template.js';

/**
 * Phase 9b, from this side of the wire.
 *
 * Registration and detection are the one part of this system that is not
 * Node: squaring up a photograph is linear algebra over pixels, and OpenCV
 * already does it. A small Python service does that and nothing else. It holds
 * no credentials, reaches no database, and is given only an image, a sheet
 * code and the geometry to read against; everything that decides what the
 * result means stays here.
 *
 * It listens on the loopback address and is never published. If it is not
 * running, the OMR path reports itself unavailable and attendance is entered
 * by hand, exactly as before Phase 9.
 */

export type CellState = 'marked' | 'blank' | 'uncertain';

export interface DetectedRow {
    index: number;
    fill_ratio: number;
    state: CellState;
    confidence: number;
}

export interface DetectionRegistration {
    markers_found: number;
    /**
     * How far the corner marks landed from where the template says they
     * belong, once the page was squared up, in pixels of the warped page. It
     * is measured on the finished warp rather than against the four points the
     * homography was solved from, which would be zero by construction and
     * would say nothing.
     */
    alignment_error_px: number;
    /**
     * The fraction of the printed box outlines found where the template says
     * they are, which is the check that actually decides whether a row was
     * read from the right place. The corner marks are the points the transform
     * was fitted to, so they always land well; the boxes do not have to.
     */
    outline_ink: number;
    rotated: boolean;
    pointer_read: string | null;
}

export interface DetectionQuality {
    blur: number;
    brightness: number;
    contrast: number;
}

export interface DetectionResult {
    status: 'detected' | 'rejected';
    reject_reason: string | null;
    sheet_code: string | null;
    template_version: string | null;
    registration: DetectionRegistration | null;
    quality: DetectionQuality | null;
    rows: DetectedRow[];
}

export const omrConfigured = Boolean(env.OMR_SERVICE_URL);

export function omrUnconfiguredReason(): string {
    return 'Reading sheets is not switched on for this installation. OMR_SERVICE_URL is not set, '
        + 'so attendance for this event has to be entered by hand from the register screen.';
}

function unavailable(detail: string): AppError {
    return new AppError(503, 'omr_unavailable',
        'The sheet reader could not be reached, so this photograph has not been read. '
        + 'Try again shortly, or enter this register by hand.', { detail });
}

/**
 * One request, one page. The service is stateless: everything it needs about
 * the layout travels with the image, so a sheet printed under an older
 * template is still read against the geometry it was printed with.
 */
export async function detectSheet(
    photo: Buffer,
    sheetCode: string,
    template: TemplateDescriptor,
): Promise<DetectionResult> {
    if (!env.OMR_SERVICE_URL)
        throw new AppError(503, 'omr_unavailable', omrUnconfiguredReason());

    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'sheet.jpg');
    form.append('sheet_code', sheetCode);
    form.append('template', JSON.stringify(template));

    const url = `${env.OMR_SERVICE_URL.replace(/\/+$/, '')}/detect`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(env.OMR_SERVICE_TIMEOUT_MS),
        });
    }
    catch (err) {
        logger.error({ err, url }, 'the OMR service could not be reached');
        throw unavailable(err instanceof Error ? err.message : 'network error');
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.error({ status: response.status, body: body.slice(0, 500) }, 'the OMR service refused the photograph');
        throw unavailable(`HTTP ${response.status}`);
    }

    const body = await response.json() as Partial<DetectionResult>;
    if (body.status !== 'detected' && body.status !== 'rejected')
        throw unavailable('the reader answered in a shape this server does not understand');

    return {
        status: body.status,
        reject_reason: body.reject_reason ?? null,
        sheet_code: body.sheet_code ?? null,
        template_version: body.template_version ?? null,
        registration: body.registration ?? null,
        quality: body.quality ?? null,
        rows: Array.isArray(body.rows) ? body.rows : [],
    };
}
