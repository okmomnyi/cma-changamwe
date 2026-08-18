exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    ALTER TABLE member_photos
      DROP COLUMN image,
      ADD COLUMN object_key text NOT NULL,
      ALTER COLUMN byte_size DROP NOT NULL;

    ALTER TABLE member_photos
      ADD CONSTRAINT member_photos_object_key_key UNIQUE (object_key);

    ALTER TABLE signup_draft_photos
      DROP COLUMN image,
      ADD COLUMN object_key text NOT NULL,
      ALTER COLUMN byte_size DROP NOT NULL;

    ALTER TABLE signup_draft_photos
      ADD CONSTRAINT signup_draft_photos_object_key_key UNIQUE (object_key);
  `);
};
exports.down = (pgm) => {
    pgm.sql(`
    ALTER TABLE signup_draft_photos DROP COLUMN object_key, ADD COLUMN image bytea NOT NULL;
    ALTER TABLE member_photos       DROP COLUMN object_key, ADD COLUMN image bytea NOT NULL;
  `);
};
