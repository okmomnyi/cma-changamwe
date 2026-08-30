import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { BACKUP_FORMAT, ESSENTIAL_TABLES, type BackupHeader, type BackupTrailer } from './format.js';

export interface VerifyExpectation {
    sha256?: string;
    rowsSha256?: string;
    rowCount?: number;
    counts?: Record<string, number>;
}

export interface VerifyResult {
    ok: boolean;
    /** Every check that ran, in order, with its outcome. */
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
    header?: BackupHeader;
    trailer?: BackupTrailer;
    rowCount: number;
    counts: Record<string, number>;
    /** The first failure, in plain words. */
    failure?: string;
}

/**
 * Decides whether a stored backup is worth keeping. An upload returning 200 is
 * not a backup: bytes rot, streams truncate, dumps run against empty tables.
 *
 * Works on bytes alone and touches no database, so it can verify a backup from
 * a machine with no access to one.
 */
export function verifyBackupBytes(body: Buffer, expected: VerifyExpectation = {}): VerifyResult {
    const checks: VerifyResult['checks'] = [];
    const counts: Record<string, number> = {};
    let rowCount = 0;
    let header: BackupHeader | undefined;
    let trailer: BackupTrailer | undefined;

    const fail = (name: string, detail: string): VerifyResult => {
        checks.push({ name, ok: false, detail });
        return { ok: false, checks, header, trailer, rowCount, counts, failure: detail };
    };
    const pass = (name: string, detail?: string) => {
        checks.push(detail ? { name, ok: true, detail } : { name, ok: true });
    };

    // 1. Not empty.
    if (body.length === 0)
        return fail('not empty', 'the stored object has no bytes at all');
    pass('not empty', `${body.length} bytes`);

    // 2. The bytes are the bytes we wrote.
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (expected.sha256 && sha256 !== expected.sha256) {
        return fail('checksum of stored bytes',
            `stored object hashes to ${sha256.slice(0, 12)} but the backup was written as ${expected.sha256.slice(0, 12)}`);
    }
    pass('checksum of stored bytes', sha256.slice(0, 16));

    // 3. It decompresses. A truncated upload fails here.
    let text: string;
    try {
        text = gunzipSync(body).toString('utf8');
    }
    catch (err) {
        return fail('decompresses',
            'the file could not be decompressed, so it was either cut short in transit or altered at rest: '
            + (err instanceof Error ? err.message : String(err)));
    }
    pass('decompresses', `${text.length} characters`);

    // 4. Every line is JSON, and the shape is what this format promises.
    const lines = text.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2)
        return fail('has a header and a trailer', 'the file has fewer than two lines');

    const rowsHash = createHash('sha256');
    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i]!;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return fail('every line parses', `line ${i + 1} of ${lines.length} is not valid JSON`);
        }
        const line = parsed as { kind?: string; table?: string };

        if (line.kind === 'header') {
            if (i !== 0) return fail('header comes first', `a header appeared at line ${i + 1}`);
            header = parsed as BackupHeader;
        }
        else if (line.kind === 'row') {
            if (!line.table) return fail('rows name their table', `line ${i + 1} has no table`);
            rowsHash.update(`${raw}\n`);
            counts[line.table] = (counts[line.table] ?? 0) + 1;
            rowCount += 1;
        }
        else if (line.kind === 'trailer') {
            if (i !== lines.length - 1)
                return fail('trailer comes last', `a trailer appeared at line ${i + 1} of ${lines.length}`);
            trailer = parsed as BackupTrailer;
        }
        else {
            return fail('every line is known', `line ${i + 1} has kind "${String(line.kind)}"`);
        }
    }
    pass('every line parses', `${lines.length} lines`);

    // 5. Both ends are present. A file with no trailer was cut short even if it
    //    happened to decompress.
    if (!header) return fail('has a header', 'no header line');
    if (!trailer) return fail('has a trailer', 'no trailer line, so the dump did not finish');
    pass('has a header and a trailer');

    if (header.format !== BACKUP_FORMAT) {
        return fail('format is understood',
            `the file says "${header.format}" but this build reads "${BACKUP_FORMAT}"`);
    }
    pass('format is understood', header.format);

    // 6. The middle is intact. This is the check that catches a file which
    //    decompresses and parses but lost rows on the way.
    const rowsSha256 = rowsHash.digest('hex');
    if (rowsSha256 !== trailer.rows_sha256) {
        return fail('row content matches its fingerprint',
            'the rows in the file do not hash to what the trailer recorded, so content changed or was lost');
    }
    pass('row content matches its fingerprint', rowsSha256.slice(0, 16));

    if (expected.rowsSha256 && rowsSha256 !== expected.rowsSha256) {
        return fail('row fingerprint matches the run',
            'the file is internally consistent but is not the backup this run wrote');
    }

    // 7. Counts agree, per table and in total.
    if (trailer.rows !== rowCount) {
        return fail('row count matches the trailer',
            `counted ${rowCount} rows, the trailer claims ${trailer.rows}`);
    }
    for (const [table, claimed] of Object.entries(trailer.counts)) {
        const seen = counts[table] ?? 0;
        if (seen !== claimed) {
            return fail('per-table counts match the trailer',
                `${table}: counted ${seen}, the trailer claims ${claimed}`);
        }
    }
    pass('counts match the trailer', `${rowCount} rows across ${Object.keys(trailer.counts).length} tables`);

    if (expected.rowCount !== undefined && expected.rowCount !== rowCount) {
        return fail('row count matches the database read',
            `the dump read ${expected.rowCount} rows but the stored file holds ${rowCount}`);
    }

    // 8. It is actually a backup of something. An empty members table means the
    //    dump ran against the wrong database, or against one mid-restore.
    for (const table of ESSENTIAL_TABLES) {
        if (!header.tables.includes(table)) {
            return fail('essential tables are present', `${table} is missing from the file`);
        }
        if ((counts[table] ?? 0) === 0) {
            return fail('essential tables have rows',
                `${table} is empty, so this is not a usable backup of a running association`);
        }
    }
    pass('essential tables have rows', ESSENTIAL_TABLES.join(', '));

    return { ok: true, checks, header, trailer, rowCount, counts };
}
