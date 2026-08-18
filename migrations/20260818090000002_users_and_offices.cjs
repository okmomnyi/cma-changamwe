exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE users (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id      uuid NOT NULL UNIQUE REFERENCES members(id) ON DELETE RESTRICT,
      username       text NOT NULL,
      password_hash  text NOT NULL,
      email          text NOT NULL,
      email_verified boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
    CREATE UNIQUE INDEX users_email_lower_key    ON users (lower(email));

    CREATE TABLE office_holders (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id       uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      office_key      text NOT NULL CHECK (office_key ~ '^[a-z][a-z0-9_]{1,48}$'),
      scope           office_scope NOT NULL DEFAULT 'parish',
      prayer_house_id uuid REFERENCES prayer_houses(id) ON DELETE RESTRICT,
      term_start      date NOT NULL,
      term_end        date,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT office_term_order CHECK (term_end IS NULL OR term_end >= term_start),
      CONSTRAINT office_scope_house CHECK (
        (scope = 'prayer_house' AND prayer_house_id IS NOT NULL) OR
        (scope = 'parish'       AND prayer_house_id IS NULL)
      )
    );

    CREATE INDEX office_holders_current_idx
      ON office_holders (member_id) WHERE term_end IS NULL;

    CREATE UNIQUE INDEX office_holders_one_current_parish
      ON office_holders (office_key)
      WHERE term_end IS NULL AND scope = 'parish';

    CREATE UNIQUE INDEX office_holders_one_current_house
      ON office_holders (office_key, prayer_house_id)
      WHERE term_end IS NULL AND scope = 'prayer_house';
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS office_holders, users CASCADE;`);
};
