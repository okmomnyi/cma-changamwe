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
| Database | Neon Postgres, raw parameterised SQL, no ORM |
| Migrations | node-pg-migrate |
| Auth | argon2id passwords, JWT access token, rotating refresh token |
| Frontend | React 19, Next.js 15, CSS Modules |
| Storage | Cloudflare R2 for member photographs |
| Email | Brevo |
| Hosting | One VPS, systemd and Caddy |
| Backups | Nightly logical export to R2, verified after upload |
| Timezone | Africa/Nairobi throughout, all timestamps timestamptz |

## Layout

```
migrations/    database schema
db/grants.sql  least-privilege grants, re-applied after every migration
deploy/        systemd units, Caddyfile, deploy script
shared/        vocabularies both the API and the interface read
src/
  config/      environment validation
  db/          pool and parameterised query helpers
  auth/        passwords, tokens, resets, office-derived authorization
  routes/      auth, member portal, admin, welfare, exports, photos, jobs
  matrix/      the scoring engine
  comms/       monthly report and leadership digest
  media/       R2 presigning
  pdf/         bio-data and report documents
  backup/      logical export, verification, retention
  jobs/        monthly scheduler
scripts/       grants and first-administrator bootstrap
web/           Next.js interface
```

## One database, two roles

Neon, for development and production alike. There is no local Postgres, no
Docker container and no separate test database.

Two connection strings, **one database**. What differs is the role:

| | Role | Used by | Can |
|---|---|---|---|
| `DATABASE_URL` | `cma_app` | the server | read and write, but not delete audit rows or rewrite a sent score |
| `MIGRATION_DATABASE_URL` | `neondb_owner` | migrations, backups, restores | change the schema |

That split is the security model. The append-only audit log and the immutable
snapshots are enforced by what `cma_app` is *not* granted, so the server must
never hold the owner's connection. Collapsing them into one would quietly
remove both guarantees.

The two strings also point at different Neon endpoints: `DATABASE_URL` at the
pooled one, `MIGRATION_DATABASE_URL` at the direct one. That mattered more under
serverless, where many short-lived connections could exhaust the limit. On the
VPS the API keeps a pool of ten, so either endpoint works; the pooled one is
kept because it costs nothing and tolerates running two API processes later.

## Local setup

Requires Node 22+. The database is Neon, so there is nothing to install for it.

```bash
npm install
npm run web:install
cp .env.example .env      # then fill in the Neon strings and the secrets

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

Windows and points follow the Matrix table in the orientation document of
1st August 2026: Weekly mass and Dominica over six months, Seminars, Novena,
Bereavement and Other over the previous three, Monthly over six months, and
Affiliation as a mandatory single item.

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
never measured against events held before they arrived. A member entered by an
officer can be given the date they were actually commissioned, so someone who
joined in 2012 is not measured from the day their record was typed.

Section 6 sets an amount against most obligations, and
`contribution_expected_amounts` holds them. A contribution below the amount for
its category does not satisfy that occurrence. Categories absent from the map
carry no floor, which is right for sick visitation (*toa ndugu*) and Archbishop
support, both given as one is able.

### Decisions the committee owns, not the code

Three settings change who qualifies for money and are not written in the
by-laws. They ship on, and the committee should record a decision either way:

- `rescale_thresholds` shrinks the thresholds in proportion to how many items a
  member could actually attempt, so an unheld event does not penalise them.
- `min_attainable` introduces a fourth standing, `insufficient_history`, below
  70 attainable points.
- `admin_offices` decides which sitting parish offices carry administrative
  access. It holds Coordinator, Treasurer and Secretary.

Each is one row:

```sql
UPDATE matrix_config SET value = 'false' WHERE key = 'rescale_thresholds';
UPDATE matrix_config SET value = '["coordinator","treasurer"]' WHERE key = 'admin_offices';
```

### Live score against snapshot

The live score is recalculated from current records on every request and is
never cached. A monthly snapshot in `matrix_scores` is what gets emailed, and is
immutable: the application role holds no UPDATE on the score columns, so a
report that has been sent cannot be rewritten.

## One source for the shared vocabularies

`shared/vocabulary.ts` holds the lists that both sides of the wire have to
agree on: event types, contribution categories, welfare support types,
attendance statuses and standings. Each of those otherwise exists three times
over, as a Postgres enum, a Zod validator and a set of form options, and the
three drift.

The API imports it as `../../shared/vocabulary.js`; the interface imports it as
`@shared/vocabulary`. The file imports nothing itself, which is what lets one
project resolving modules as NodeNext and another resolving as a bundler both
consume it with no build step in between.

`valuesOf` returns the literal union rather than `string`, so a value the form
offers that the API would reject is a compile error rather than a support call.

The database enum is still the authority. Write the migration first, then widen
the list.

## Offices and governance

Offices exist at two levels, matching the structure in the orientation
document. A parish term is the executive; a prayer-house term leads one of the
six houses. **Only a sitting parish term carries administrative access.** A
prayer-house coordinator leads that house and has no authority over the parish.

The offices themselves live in `office_types`, one row per office, with
`parish_scope` and `house_scope` recording where each legitimately sits. The
handover form reads that table, so the list cannot drift from what the database
will accept, and an office key that is not an office is refused rather than
silently created.

Terms run three years to a maximum of two, per section 3.2. Opening a third
term is refused unless a reason is supplied, which the audit log keeps. The
offices screen flags a term that has run past its three years.

The last sitting office carrying administrative access cannot be closed on its
own, because that would lock everyone out. Use the handover, which closes and
opens in one step.

## Welfare support

The Matrix decides eligibility. `welfare_claims` records the decision and the
payment, under section 5.3: KES 10,000 pre-wedding, 5,000 wedding gift, 10,000
sickness advance, 100,000 on the death of a member or spouse, 50,000 for a
child under 18, 25,000 for a parent.

A decision is bound to the immutable monthly snapshot it relied on, never to
the live score, so an approval can still be explained a year later. Approving a
member who was not in good standing requires a reason, and so does approving
with no snapshot on file. The over-seven-days rule for a sickness advance is a
database constraint; the under-18 rule for a child is checked against the date
of birth on the member record.

The application role holds no DELETE on `welfare_claims`, and may update only
the decision and payment columns. A claim can be withdrawn; it cannot be
removed, and its amount and subject cannot be rewritten after the fact.

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

A snapshot is only ever taken for a month that has ended, and is evaluated as
of that month's last day. Taking one for the current month would freeze a part
month that could never be corrected, so it is refused.

A member enrolled by an officer may have no account, and their report has
nowhere to go. Those rows are marked `failed` rather than left pending, so a
period can still finish. Failed reports are counted on the Matrix screen and
can be put back in the queue from there.

## Deploying

Two Node processes behind Caddy on one VPS. Caddy terminates TLS and routes
`/api/*` to the API and everything else to Next.js, so the browser only ever
sees one origin. That is what lets the refresh cookie stay `SameSite=Strict`
with no CORS anywhere.

```
Caddy :443  ->  /api/*  cma-api :3000  ->  Neon, R2
            ->  /*      cma-web :3001
```

`deploy/` holds the systemd units, the Caddyfile and a deploy script;
`deploy/README.md` has the steps. On the VPS five values differ from local:

```bash
NODE_ENV=production
SECURE_COOKIES=true
TRUST_PROXY=true
PUBLIC_BASE_URL=https://<domain>
ALLOW_DEMO_LOGIN=false
```

### Scheduled work

`SERVERLESS=false`, so the long-lived API process runs both jobs from its own
timer, checking every fifteen minutes. No external cron is needed.

| Nairobi | Does |
|---|---|
| from 02:00 | Off-site backup, verify, prune. Skipped once one is verified for the day. |
| 06:00 to 20:00 | Monthly snapshots on the 1st, the leadership digest, one report batch a day. |

Both are idempotent, so a restart mid-run costs nothing. The same work is also
reachable over HTTP with `CRON_SECRET` as a bearer token, if you would rather
drive it from system cron:

```bash
curl -X POST https://<domain>/api/jobs/run-backup -H "authorization: Bearer $CRON_SECRET"
curl -X POST https://<domain>/api/jobs/run-daily  -H "authorization: Bearer $CRON_SECRET"
```

## Security

- Authorization is checked on the server for every endpoint. Administrative
  capability is derived from currently held offices on each request; hiding a
  button is never the control.
- Parameterised SQL only. No query is built by string concatenation.
- argon2id passwords. Refresh tokens and one-time codes are stored hashed.
- The audit log is append-only, enforced both by grants and by database triggers
  that refuse UPDATE, DELETE and TRUNCATE even for the schema owner.
- Rate limits on sign-in, code sending, code verification, password resets and
  report downloads.
- A password reset revokes every session. A password change keeps the session
  that made it and revokes the rest.
- The demo sign-in bypass is decided by `ALLOW_DEMO_LOGIN`, not by a data value
  an administrator could edit.
- Upload keys are recorded against the draft or member they were issued to, and
  confirmation checks that record rather than the shape of the key.
- CSV cells that would be read as a formula are escaped, because member names
  come from public registration.
- Secrets are redacted at the logger rather than at each call site.
- Body-parser failures answer 400, 413 or 415 rather than 500, so a caller's
  mistake is not reported as a server fault.
- No member endpoint returns another member's personal data. Directory listings
  mask identity numbers; the full value appears only on a single-member view.
