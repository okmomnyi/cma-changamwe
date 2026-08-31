import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().min(1).optional(),
    APP_DB_USER: z.string().min(1).default('cma_app'),
    APP_DB_PASSWORD: z.string().optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    SECURE_COOKIES: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    COOKIE_DOMAIN: z.string().optional(),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    TRUST_PROXY: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SERVERLESS: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    CRON_SECRET: z.string().min(16).optional(),
    // Lets accounts whose ID begins DEMO- sign in without the emailed code, so
    // a reviewer can get in. Deployment decides this, never a data value.
    ALLOW_DEMO_LOGIN: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_PHOTOS_PREFIX: z.string().default('pictures'),
    R2_PHOTOS_BUCKET: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_PHOTOS_ACCESS_KEY_ID: z.string().optional(),
    R2_PHOTOS_SECRET_ACCESS_KEY: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    R2_BACKUPS_PREFIX: z.string().default('docs'),
    R2_UPLOAD_URL_TTL: z.coerce.number().int().positive().max(3600).default(300),
    R2_VIEW_URL_TTL: z.coerce.number().int().positive().max(86400).default(900),
    BREVO_API_KEY: z.string().optional(),
    BREVO_SENDER_EMAIL: z.string().email().optional(),
    BREVO_SENDER_NAME: z.string().default('CMA Changamwe'),
    EMAIL_DAILY_BATCH_SIZE: z.coerce.number().int().positive().default(200),
    // How many days of off-site backups to keep. Below this, a backup is only
    // removed once BACKUP_MIN_KEEP verified newer ones exist.
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    BACKUP_MIN_KEEP: z.coerce.number().int().min(1).max(60).default(3),
    // Ed25519 private key, PEM, base64 encoded. Seals every issued document.
    // Generate with: npm run documents:keygen
    DOCUMENT_SIGNING_KEY: z.string().optional(),

    // Phase 9. Photographs of attendance sheets. They carry member names, so
    // they live in the same private bucket as the photographs, under their own
    // prefix, and never in anything public.
    R2_SCANS_PREFIX: z.string().default('scans'),

    // The register-and-detect service. It is reached over the loopback address
    // and is never exposed publicly: it holds no credentials and is given only
    // a photograph and the geometry to read it against. Unset means the OMR
    // path is switched off and attendance is entered by hand, as in Phase 4.
    OMR_SERVICE_URL: z.string().url().optional(),
    OMR_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),

    // Once the month a meeting falls in has a finalised snapshot, the image
    // has done its work: the measurements and the hash stay for the audit, and
    // the photograph is purged. The backstop purges anything older regardless,
    // so an unclosed month cannot keep member names on disk indefinitely.
    SCAN_PHOTO_MIN_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SCAN_PHOTO_MAX_DAYS: z.coerce.number().int().min(1).max(1095).default(180),
});
const present = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''));
const parsed = schema.safeParse(present);
if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
}
export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
