# CMA Changamwe

Member and performance management for the Catholic Men Association, Changamwe
(roughly 435 members across six prayer houses). It holds member records,
attendance, matoleo (contributions), and the performance formula that determines
welfare standing for wedding, sickness and bereavement support.

Because that formula gates real payments, correctness and auditability are
treated as build requirements rather than polish.

## Stack

| Layer | Choice |
|---|---|
| Backend | Node.js 22, Express 5, TypeScript (ESM) |
| Database | PostgreSQL, raw parameterised SQL, no ORM |
| Migrations | node-pg-migrate |
| Auth | argon2id passwords, JWT access token, rotating refresh token |
| Frontend | React 19, Next.js 15, CSS Modules |
| Storage | Cloudflare R2 for member photographs |
| Email | Brevo |
| Timezone | Africa/Nairobi throughout, all timestamps timestamptz |

## Layout

```
migrations/    database schema
db/grants.sql  least-privilege grants, re-applied after every migration
src/
  config/      environment validation
  db/          pool and parameterised query helpers
  auth/        passwords, tokens, office-derived authorization
  routes/      auth, member portal, admin, exports, photos, jobs
  matrix/      the scoring engine
  comms/       monthly report and leadership digest
  media/       R2 presigning
  pdf/         bio-data and report documents
  jobs/        monthly scheduler
scripts/       grants and first-administrator bootstrap
api/           Vercel serverless entry
web/           Next.js interface
```

## Local setup

Requires Node 22+ and PostgreSQL 17+.

```bash
npm install
npm run web:install
cp .env.example .env
createdb cma_changamwe

npm run migrate
npm run dev
npm run web:dev
```

The API serves on port 3000 and the interface on 3001. `JWT_SECRET` must be at
least 32 characters.

### First administrator

Public sign-up creates members, not officers. Seat the first one directly:

```bash
npm run bootstrap:admin -- \
  --name "Peter Otieno" --id-no 22334455 --mobile 0722100100 \
  --year-of-birth 1975 --prayer-house "Noor" --marital-status married \
  --next-of-kin "Mary Otieno" --next-of-kin-mobile 0722100101 \
  --username coordinator --email coordinator@example.org \
  --password 'a real passphrase' --office coordinator
```

Administrative access follows the office, not the person. Closing that term
removes the access on the next request.

## Two database roles

- owner (`MIGRATION_DATABASE_URL`) owns the schema and runs migrations.
- app (`DATABASE_URL`) is what the server connects as. No DDL. INSERT and
  SELECT only on `audit_log`. On `matrix_scores`, INSERT and SELECT plus UPDATE
  on `(email_status, sent_at)` alone, so stored scores are immutable.

`db/grants.sql` is repeatable and runs automatically after every migration, so a
new table cannot ship without its privileges being considered.

## The Matrix

Scoring is data-driven. Which items exist, what they are worth, how wide their
window is and what they draw on all live in `matrix_rules`; thresholds and
toggles live in `matrix_config`. Only the window evaluators are code.

| Window type | Used by | Counts |
|---|---|---|
| `rolling_months` | Fridays (3), Dominica (6), Monthly (6) | events, or months, in a rolling window |
| `last_n_occurrences` | Seminars, Bereavement, Other | the last N occurrences |
| `last_n_series` | Novena | the last N series, counting the days inside them |
| `mandatory` | Affiliation | a fixed denominator of 1 |
| `frequency` | Weddings | qualifying events in a window, and who paid toward them |

The formula is `item_score = (count / total) x points`, summed per category:
60 points spirituality, 40 financial. There is no threshold-met-therefore-full-
points step. A per-item threshold is a flag for pastoral follow-up, not a score
modifier, unless that rule's `hard_gate` is turned on.

Changing scoring is a database change:

```sql
UPDATE matrix_rules SET window_value = 6 WHERE item_key = 'fridays';
UPDATE matrix_config SET value = 'false' WHERE key = 'enforce_category_mins';
```

Every denominator is bounded by the date a member joined, so a new member is
never measured against events held before they arrived.

### Live score against snapshot

The live score is recalculated from current records on every request and is
never cached. A monthly snapshot in `matrix_scores` is what gets emailed, and is
immutable: the application role holds no UPDATE on the score columns, so a
report that has been sent cannot be rewritten.

## Member photographs

Photographs are compressed in the browser and uploaded straight to Cloudflare
R2. The bytes never pass through the API, and the database holds only the object
key.

```
browser: compress to 600x600 JPEG, which also drops EXIF including GPS
   |  POST .../photo/upload-url   ->  presigned PUT and a server-chosen key
   v
  R2  <---- PUT direct ----  browser
   |  POST .../photo/confirm      ->  server checks the object, records the key
   v
Postgres: object_key
```

The bucket stays private. Viewing goes through a short-lived presigned URL that
the server issues only after checking who is asking.

One bucket, two folders: `pictures/` for photographs and `docs/` for exports.
R2 tokens scope to a bucket rather than a folder, so a single credential reaches
both; setting `R2_PHOTOS_BUCKET` separates them.

The bucket needs a CORS rule or the browser upload is blocked:

```json
[{
  "AllowedOrigins": ["https://your-host", "http://localhost:3001"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["content-type"],
  "MaxAgeSeconds": 3600
}]
```

## Monthly reports

On the 1st, Africa/Nairobi, the previous month's snapshots are written, the
leadership digest goes to the sitting officers, and member reports are sent one
batch a day until the period is delivered.

The send is resumable by construction: `email_status` is the only queue, each
row is claimed with `FOR UPDATE SKIP LOCKED` in its own transaction, and a
restart simply asks for what is still pending.

Without `BREVO_API_KEY` the mailer does not pretend to succeed. In development
it logs the message so the flow stays usable; in production it reports failure.

## Deploying to Vercel

Two projects, so the browser stays on one origin. That is what lets the refresh
cookie remain SameSite=Strict with no CORS anywhere.

```
browser -> cma-web (Next.js) --rewrite--> cma-api (Express function) -> Postgres
```

cma-api: root directory is the repository root, framework "Other".

```bash
NODE_ENV=production
SERVERLESS=true
DATABASE_URL=<pooled connection string>
MIGRATION_DATABASE_URL=<direct connection string>
JWT_SECRET=<48 random bytes, base64>
CRON_SECRET=<32 random bytes, hex>
SECURE_COOKIES=true
TRUST_PROXY=true
PUBLIC_BASE_URL=https://<web domain>
```

cma-web: root directory `web`, framework Next.js, one variable:

```bash
API_ORIGIN=https://<api domain>
```

Deploy the API first, then the web project, then add the web domain to the R2
bucket's CORS origins.

`SERVERLESS=true` matters. It holds one database connection per instance,
because pooling belongs upstream, and skips the in-process timer, because a
serverless platform has no process between requests.

Use a pooled connection string for the application and a direct one for
migrations: schema changes are unreliable through a transaction-mode pooler.

### The scheduled job

`vercel.json` registers a daily cron at 04:00 UTC, which is 07:00 in Nairobi. It
calls `/api/jobs/run-daily` with `CRON_SECRET` as a bearer token. Everything
behind it is idempotent, so a duplicate trigger, a missed one, or a retry after
a timeout all behave.

```bash
curl -X POST https://<api>/api/jobs/run-daily -H "authorization: Bearer $CRON_SECRET"
```

Backups are not part of the Vercel deployment; there is no long-lived process to
run them. Use the hosting provider's own backups, or run `pg_dump` on a schedule
from somewhere that has one.

## Security

- Authorization is checked on the server for every endpoint. Administrative
  capability is derived from currently held offices on each request; hiding a
  button is never the control.
- Parameterised SQL only. No query is built by string concatenation.
- argon2id passwords. Refresh tokens and one-time codes are stored hashed.
- The audit log is append-only, enforced both by grants and by database triggers
  that refuse UPDATE, DELETE and TRUNCATE even for the schema owner.
- Rate limits on sign-in, code sending, code verification and report downloads.
- Secrets are redacted at the logger rather than at each call site.
- No member endpoint returns another member's personal data. Directory listings
  mask identity numbers; the full value appears only on a single-member view.
