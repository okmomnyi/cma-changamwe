exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE member_photos (
      member_id    uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
      byte_size    integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
      width        integer,
      height       integer,
      image        bytea NOT NULL,
      uploaded_at  timestamptz NOT NULL DEFAULT now(),
      uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE signup_draft_photos (
      draft_id     uuid PRIMARY KEY REFERENCES signup_drafts(id) ON DELETE CASCADE,
      content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
      byte_size    integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
      width        integer,
      height       integer,
      image        bytea NOT NULL,
      uploaded_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS signup_draft_photos, member_photos;`);
};
