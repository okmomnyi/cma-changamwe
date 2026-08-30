import {
    S3Client, PutObjectCommand, GetObjectCommand,
    DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { isBackupKey } from './format.js';

/**
 * Backups share the photographs' bucket under their own prefix. R2 tokens scope
 * to a bucket, not a folder, so one credential reaches both.
 */
const bucket = env.R2_BUCKET;
const accessKeyId = env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
const endpoint = env.R2_ENDPOINT
    ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

export const BACKUP_PREFIX = env.R2_BACKUPS_PREFIX.replace(/^\/+|\/+$/g, '') || 'docs';
export const backupsConfigured = Boolean(bucket && accessKeyId && secretAccessKey && endpoint);

export function backupsUnconfiguredReason(): string {
    const missing: string[] = [];
    if (!bucket) missing.push('R2_BUCKET');
    if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
    if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
    if (!endpoint) missing.push('R2_ACCOUNT_ID (or R2_ENDPOINT)');
    return `Off-site backups are not configured. Missing: ${missing.join(', ')}.`;
}

const client = backupsConfigured
    ? new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    })
    : null;

function requireClient(): S3Client {
    if (!client) throw new Error(backupsUnconfiguredReason());
    return client;
}

export async function putBackup(key: string, body: Buffer, meta: Record<string, string>): Promise<void> {
    await requireClient().send(new PutObjectCommand({
        Bucket: bucket!,
        Key: key,
        Body: body,
        ContentType: 'application/gzip',
        // Read back during verification, so a mismatch between what the object
        // claims and what it contains is caught rather than assumed away.
        Metadata: meta,
    }));
}

export async function getBackup(key: string): Promise<Buffer> {
    const result = await requireClient().send(new GetObjectCommand({ Bucket: bucket!, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error('the stored backup came back empty');
    return Buffer.from(bytes);
}


export interface StoredBackup {
    key: string;
    size: number;
    lastModified: Date | null;
}

export async function listBackups(): Promise<StoredBackup[]> {
    const out: StoredBackup[] = [];
    let token: string | undefined;
    do {
        const page = await requireClient().send(new ListObjectsV2Command({
            Bucket: bucket!,
            Prefix: `${BACKUP_PREFIX}/backups/`,
            ContinuationToken: token,
        }));
        for (const obj of page.Contents ?? []) {
            // Never touch anything this application did not write.
            if (obj.Key && isBackupKey(BACKUP_PREFIX, obj.Key)) {
                out.push({
                    key: obj.Key,
                    size: Number(obj.Size ?? 0),
                    lastModified: obj.LastModified ?? null,
                });
            }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    out.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    return out;
}

export async function deleteBackup(key: string): Promise<void> {
    if (!isBackupKey(BACKUP_PREFIX, key)) {
        throw new Error(`refusing to delete "${key}": it is not a backup this application wrote`);
    }
    try {
        await requireClient().send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
    }
    catch (err) {
        logger.warn({ err, key }, 'could not delete an expired backup from R2');
        throw err;
    }
}
