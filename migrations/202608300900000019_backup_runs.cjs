exports.shorthands = undefined;

/**
 * Every backup taken, and whether it was read back and proved sound. The row is
 * written before the upload, so a job that dies halfway leaves evidence.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE backup_status AS ENUM ('running','verified','failed','pruned');

    CREATE TABLE backup_runs (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      object_key        text UNIQUE,
      status            backup_status NOT NULL DEFAULT 'running',

      started_at        timestamptz NOT NULL DEFAULT now(),
      finished_at       timestamptz,
      verified_at       timestamptz,
      pruned_at         timestamptz,

      byte_size         bigint CHECK (byte_size IS NULL OR byte_size >= 0),
      row_count         bigint CHECK (row_count IS NULL OR row_count >= 0),
      table_counts      jsonb,

      -- Of the stored bytes, so a silent corruption in R2 is detectable.
      sha256            text,
      -- Of the row lines alone, so a truncation inside the file is detectable
      -- even when the object as a whole still decompresses.
      rows_sha256       text,

      schema_version    text,
      neon_branch       text,
      duration_ms       integer,
      note              text,
      error             text
    );

    CREATE INDEX backup_runs_started_idx ON backup_runs (started_at DESC);
    CREATE INDEX backup_runs_status_idx  ON backup_runs (status, started_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS backup_runs;
    DROP TYPE IF EXISTS backup_status;
  `);
};
