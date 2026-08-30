exports.shorthands = undefined;

/**
 * Every PDF the system issues, so its authenticity can be checked afterwards
 * by someone who was never given an account.
 *
 * The hash is of the finished PDF bytes, and the signature is over that hash,
 * so an altered file fails the check even though the document id still reads
 * correctly on the page. Nothing here can be deleted: a document that was
 * issued stays issued, and is withdrawn by revoking it rather than by removing
 * the evidence that it existed.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE document_kind AS ENUM (
      'member_biodata',
      'matrix_report',
      'member_roster',
      'contributions_statement',
      'matrix_summary',
      'welfare_statement');

    CREATE TABLE documents (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id    text NOT NULL UNIQUE
                     CHECK (document_id ~ '^CMA-[0-9]{4}-[A-Z]{3}-[0-9A-Z]{6}$'),
      kind           document_kind NOT NULL,
      title          text NOT NULL,

      subject_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
      subject_label  text,
      period         text CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

      sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      signature      text NOT NULL,
      key_id         text NOT NULL,

      byte_size      integer CHECK (byte_size IS NULL OR byte_size > 0),
      page_count     integer,
      metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,

      issued_at      timestamptz NOT NULL DEFAULT now(),
      issued_by      uuid REFERENCES users(id) ON DELETE SET NULL,
      revoked_at     timestamptz,
      revoked_reason text,

      CONSTRAINT revocation_has_a_reason CHECK (
        revoked_at IS NULL OR revoked_reason IS NOT NULL
      )
    );

    CREATE INDEX documents_issued_idx  ON documents (issued_at DESC);
    CREATE INDEX documents_subject_idx ON documents (subject_member_id, issued_at DESC)
      WHERE subject_member_id IS NOT NULL;
    CREATE INDEX documents_sha_idx     ON documents (sha256);
    CREATE INDEX documents_kind_idx    ON documents (kind, issued_at DESC);

    CREATE FUNCTION documents_are_permanent() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'documents cannot be removed: revoke it instead'
        USING ERRCODE = 'insufficient_privilege';
    END;
    $fn$;

    CREATE TRIGGER documents_no_delete
      BEFORE DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION documents_are_permanent();

    CREATE TRIGGER documents_no_truncate
      BEFORE TRUNCATE ON documents
      FOR EACH STATEMENT EXECUTE FUNCTION documents_are_permanent();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS documents_no_truncate ON documents;
    DROP TRIGGER IF EXISTS documents_no_delete ON documents;
    DROP FUNCTION IF EXISTS documents_are_permanent();
    DROP TABLE IF EXISTS documents CASCADE;
    DROP TYPE IF EXISTS document_kind;
  `);
};
