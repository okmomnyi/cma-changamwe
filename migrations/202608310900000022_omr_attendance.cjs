exports.shorthands = undefined;

/**
 * Phase 9. Reading attendance off a photographed sheet.
 *
 * A sheet is printed from the register with the members already on it, ticked
 * by hand at the meeting, then photographed. The row a tick belongs to is
 * resolved through `row_manifest`, which is stored here when the sheet is
 * made: nothing in the pipeline ever reads a printed name.
 *
 * Because this data decides who qualifies for welfare money, every committed
 * row carries where it came from. `attendance.source` says manual or OMR, and
 * an OMR row points back at the scan, which points at the sheet, the photo and
 * the per-cell measurements the machine made.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE attendance_source      AS ENUM ('manual','omr');
    CREATE TYPE attendance_scan_status AS ENUM (
      'uploaded','registered','detected','reviewed','committed','rejected');

    CREATE TABLE attendance_sheets (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id         uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
      prayer_house_id  uuid REFERENCES prayer_houses(id) ON DELETE RESTRICT,

      -- One printing run. A torn or lost sheet is reprinted rather than
      -- photocopied, which makes a second set of pages for the same event;
      -- coverage is judged within a run, not across every sheet ever made.
      generation_id    uuid NOT NULL,
      page_no          integer NOT NULL CHECK (page_no >= 1),
      total_pages      integer NOT NULL CHECK (total_pages >= 1),

      sheet_code       text NOT NULL UNIQUE
                       CHECK (sheet_code ~ '^[2-9A-HJ-NP-Z]{10}$'),
      template_version text NOT NULL,

      -- The ordered member ids the printed rows stand for. Row n of the sheet
      -- is member row_manifest->>n, whatever the paper says.
      row_manifest     jsonb NOT NULL,

      -- The sealed PDF the pages were printed from.
      document_id      text REFERENCES documents(document_id) ON DELETE RESTRICT,

      generated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
      generated_at     timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT sheet_page_within_total CHECK (page_no <= total_pages),
      CONSTRAINT sheet_manifest_is_a_list CHECK (jsonb_typeof(row_manifest) = 'array'),
      CONSTRAINT sheet_one_page_per_run UNIQUE (generation_id, page_no)
    );
    CREATE INDEX attendance_sheets_event_idx ON attendance_sheets (event_id, generated_at DESC);
    CREATE INDEX attendance_sheets_run_idx   ON attendance_sheets (generation_id, page_no);

    CREATE TABLE attendance_scans (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sheet_id       uuid NOT NULL REFERENCES attendance_sheets(id) ON DELETE RESTRICT,

      -- The object key in private storage. Cleared when the image is purged
      -- after the period is closed; the hash and the measurements stay, so an
      -- old commit can still be explained.
      photo_ref      text,
      photo_hash     text CHECK (photo_hash IS NULL OR photo_hash ~ '^[0-9a-f]{64}$'),
      byte_size      integer CHECK (byte_size IS NULL OR byte_size > 0),

      status         attendance_scan_status NOT NULL DEFAULT 'uploaded',
      reject_reason  text,

      -- Per row: fill_ratio, state, confidence, and any human override, plus
      -- the whole-sheet quality figures the service measured.
      detection_json jsonb NOT NULL DEFAULT '{}'::jsonb,

      uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at    timestamptz NOT NULL DEFAULT now(),
      reviewed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at    timestamptz,
      committed_at   timestamptz,
      photo_purged_at timestamptz,

      CONSTRAINT scan_rejection_has_a_reason CHECK (
        status <> 'rejected' OR reject_reason IS NOT NULL)
    );
    CREATE INDEX attendance_scans_sheet_idx  ON attendance_scans (sheet_id, uploaded_at DESC);
    CREATE INDEX attendance_scans_status_idx ON attendance_scans (status, uploaded_at DESC);

    -- The same photograph sent twice is the same photograph.
    CREATE UNIQUE INDEX attendance_scans_not_twice
      ON attendance_scans (sheet_id, photo_hash) WHERE photo_hash IS NOT NULL;

    ALTER TABLE attendance
      ADD COLUMN source  attendance_source NOT NULL DEFAULT 'manual',
      ADD COLUMN scan_id uuid REFERENCES attendance_scans(id) ON DELETE RESTRICT;

    ALTER TABLE attendance
      ADD CONSTRAINT attendance_scan_only_when_read_off_a_sheet
      CHECK (scan_id IS NULL OR source = 'omr');

    CREATE INDEX attendance_scan_idx ON attendance (scan_id) WHERE scan_id IS NOT NULL;

    -- Upload keys are already bound to whoever they were issued for. A scan is
    -- issued against the sheet it is a photograph of, so the same table does
    -- the same job for it.
    ALTER TABLE photo_upload_grants DROP CONSTRAINT photo_upload_grants_scope_check;
    ALTER TABLE photo_upload_grants ADD CONSTRAINT photo_upload_grants_scope_check
      CHECK (scope IN ('members','drafts','scans'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM photo_upload_grants WHERE scope = 'scans';
    ALTER TABLE photo_upload_grants DROP CONSTRAINT photo_upload_grants_scope_check;
    ALTER TABLE photo_upload_grants ADD CONSTRAINT photo_upload_grants_scope_check
      CHECK (scope IN ('members','drafts'));
    ALTER TABLE attendance
      DROP CONSTRAINT IF EXISTS attendance_scan_only_when_read_off_a_sheet;
    ALTER TABLE attendance DROP COLUMN IF EXISTS scan_id;
    ALTER TABLE attendance DROP COLUMN IF EXISTS source;
    DROP TABLE IF EXISTS attendance_scans CASCADE;
    DROP TABLE IF EXISTS attendance_sheets CASCADE;
    DROP TYPE IF EXISTS attendance_scan_status;
    DROP TYPE IF EXISTS attendance_source;
  `);
};
