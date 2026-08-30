exports.shorthands = undefined;

/**
 * Binds each upload key to the draft or member it was issued for. Confirmation
 * used to accept any well-formed key, resting on a UUID being unguessable.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE photo_upload_grants (
      object_key  text PRIMARY KEY,
      scope       text NOT NULL CHECK (scope IN ('members','drafts')),
      owner_id    uuid NOT NULL,
      issued_by   uuid REFERENCES users(id) ON DELETE SET NULL,
      issued_at   timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL,
      consumed_at timestamptz
    );

    CREATE INDEX photo_upload_grants_owner_idx  ON photo_upload_grants (scope, owner_id);
    CREATE INDEX photo_upload_grants_expiry_idx ON photo_upload_grants (expires_at)
      WHERE consumed_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS photo_upload_grants;`);
};
