exports.shorthands = undefined;

/**
 * The ten offices of section 3.1, as a table. `office_key` was free text behind
 * a regex, and the list lived in three places that could drift; a typo created
 * a new office silently. `parish_scope` and `house_scope` record where each one
 * legitimately sits.
 *
 * Existing keys are carried across before the foreign key is added, so no
 * recorded term is invalidated.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE office_types (
      office_key   text PRIMARY KEY CHECK (office_key ~ '^[a-z][a-z0-9_]{1,48}$'),
      label        text NOT NULL,
      parish_scope boolean NOT NULL DEFAULT true,
      house_scope  boolean NOT NULL DEFAULT true,
      sort_order   integer NOT NULL DEFAULT 0,
      active       boolean NOT NULL DEFAULT true,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT office_has_a_scope CHECK (parish_scope OR house_scope)
    );
  `);

  pgm.sql(`
    INSERT INTO office_types (office_key, label, parish_scope, house_scope, sort_order) VALUES
      ('coordinator',         'Coordinator',                     true,  true,  10),
      ('asst_coordinator',    'Assistant Coordinator',           true,  true,  20),
      ('secretary',           'Secretary',                       true,  true,  30),
      ('asst_secretary',      'Assistant Secretary',             true,  true,  40),
      ('treasurer',           'Treasurer',                       true,  true,  50),
      ('organizing_sec',      'Organizing Secretary',            true,  true,  60),
      ('asst_organizing_sec', 'Assistant Organizing Secretary',  true,  false, 70),
      ('liturgist',           'Liturgist',                       true,  true,  80),
      ('marriage_counselor',  'Marriage Counselor',              true,  true,  90),
      ('shg_rep',             'SHG Representative',              true,  false, 100)
    ON CONFLICT (office_key) DO NOTHING;
  `);

  // Anything already recorded is kept, so the foreign key cannot reject a term
  // that predates this table. Such a row is marked inactive: it stays valid and
  // stops being offered for a new appointment.
  pgm.sql(`
    INSERT INTO office_types (office_key, label, sort_order, active)
    SELECT DISTINCT oh.office_key,
           initcap(replace(oh.office_key, '_', ' ')),
           900,
           false
      FROM office_holders oh
     WHERE NOT EXISTS (SELECT 1 FROM office_types t WHERE t.office_key = oh.office_key);
  `);

  pgm.sql(`
    ALTER TABLE office_holders
      ADD CONSTRAINT office_holders_office_key_fkey
      FOREIGN KEY (office_key) REFERENCES office_types(office_key)
      ON UPDATE CASCADE ON DELETE RESTRICT;

    CREATE INDEX office_holders_office_key_idx ON office_holders (office_key);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS office_holders_office_key_idx;
    ALTER TABLE office_holders DROP CONSTRAINT IF EXISTS office_holders_office_key_fkey;
    DROP TABLE IF EXISTS office_types;
  `);
};
