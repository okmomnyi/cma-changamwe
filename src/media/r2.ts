import { createHash, randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { badRequest } from '../util/errors.js';
export const MAX_PHOTO_BYTES = 1500000;
export const PHOTO_CONTENT_TYPE = 'image/jpeg';
const bucket = env.R2_PHOTOS_BUCKET ?? env.R2_BUCKET;
const accessKeyId = env.R2_PHOTOS_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_PHOTOS_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY;
const endpoint = env.R2_ENDPOINT
    ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const PHOTO_PREFIX = env.R2_PHOTOS_PREFIX.replace(/^\/+|\/+$/g, '') || 'pictures';
export const photosConfigured = Boolean(bucket && accessKeyId && secretAccessKey && endpoint);
export function photosUnconfiguredReason(): string {
    const missing: string[] = [];
    if (!bucket)
        missing.push('R2_BUCKET');
    if (!accessKeyId)
        missing.push('R2_ACCESS_KEY_ID');
    if (!secretAccessKey)
        missing.push('R2_SECRET_ACCESS_KEY');
    if (!endpoint)
        missing.push('R2_ACCOUNT_ID (or R2_ENDPOINT)');
    return `Photo storage is not configured. Missing: ${missing.join(', ')}.`;
}
const client = photosConfigured
    ? new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    })
    : null;
function requireClient(): S3Client {
    if (!client)
        throw badRequest(photosUnconfiguredReason());
    return client;
}
export function newPhotoKey(scope: 'members' | 'drafts', ownerId: string): string {
    const shard = createHash('sha256').update(ownerId).digest('hex').slice(0, 2);
    return `${PHOTO_PREFIX}/${scope}/${shard}/${randomUUID()}.jpg`;
}
export function isValidPhotoKey(key: string): boolean {
    const pattern = new RegExp(`^${PHOTO_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(members|drafts)/[0-9a-f]{2}/[0-9a-f-]{36}\\.jpg$`);
    return pattern.test(key);
}
export async function presignUpload(key: string): Promise<{
    url: string;
    expires_in: number;
}> {
    const url = await getSignedUrl(requireClient(), new PutObjectCommand({
        Bucket: bucket!,
        Key: key,
        ContentType: PHOTO_CONTENT_TYPE,
    }), { expiresIn: env.R2_UPLOAD_URL_TTL });
    return { url, expires_in: env.R2_UPLOAD_URL_TTL };
}
export async function presignView(key: string): Promise<{
    url: string;
    expires_in: number;
}> {
    const url = await getSignedUrl(requireClient(), new GetObjectCommand({ Bucket: bucket!, Key: key }), { expiresIn: env.R2_VIEW_URL_TTL });
    return { url, expires_in: env.R2_VIEW_URL_TTL };
}
export interface UploadedObject {
    byteSize: number;
    contentType: string;
}
export async function verifyUploaded(key: string): Promise<UploadedObject> {
    const head = await requireClient().send(new HeadObjectCommand({
        Bucket: bucket!, Key: key,
    }));
    const byteSize = Number(head.ContentLength ?? 0);
    const contentType = head.ContentType ?? '';
    if (byteSize <= 0)
        throw badRequest('That upload did not arrive. Please try again.');
    if (byteSize > MAX_PHOTO_BYTES) {
        await deleteObject(key);
        throw badRequest('That photo is too large once compressed. Please choose another.');
    }
    if (contentType !== PHOTO_CONTENT_TYPE) {
        await deleteObject(key);
        throw badRequest('That upload was not a JPEG image.');
    }
    return { byteSize, contentType };
}
export async function deleteObject(key: string): Promise<void> {
    if (!client)
        return;
    try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
    }
    catch (err) {
        logger.warn({ err, key }, 'could not delete photo object from R2');
    }
}
export async function fetchPhotoBytes(key: string): Promise<Buffer | null> {
    if (!client)
        return null;
    try {
        const result = await client.send(new GetObjectCommand({
            Bucket: bucket!, Key: key,
        }));
        const bytes = await result.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
    }
    catch (err) {
        logger.warn({ err, key }, 'could not fetch photo from R2 for the PDF');
        return null;
    }
}
