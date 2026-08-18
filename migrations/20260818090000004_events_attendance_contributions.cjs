exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE events (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type            event_type NOT NULL,
      subtype         text,
      matrix_item_key text REFERENCES matrix_rules(item_key) ON UPDATE CASCADE ON DELETE RESTRICT,
      novena_series_id uuid,
      title           text NOT NULL,
      date            date NOT NULL,
      description     text,
      prayer_house_id uuid REFERENCES prayer_houses(id) ON DELETE RESTRICT,
      created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT novena_series_only_on_novena CHECK (
        novena_series_id IS NULL OR type = 'novena'
      )
    );
    CREATE INDEX events_matrix_item_date_idx ON events (matrix_item_key, date)
      WHERE matrix_item_key IS NOT NULL;
    CREATE INDEX events_date_idx             ON events (date);
    CREATE INDEX events_novena_series_idx    ON events (novena_series_id)
      WHERE novena_series_id IS NOT NULL;

    CREATE TABLE attendance (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id   uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      event_id    uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
      status      attendance_status NOT NULL,
      reason      text,
      recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT attendance_one_per_member_event UNIQUE (member_id, event_id)
    );
    CREATE INDEX attendance_member_event_idx ON attendance (member_id, event_id);
    CREATE INDEX attendance_event_idx        ON attendance (event_id);

    CREATE TABLE contributions (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id          uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      event_id           uuid REFERENCES events(id) ON DELETE RESTRICT,
      category           contribution_category NOT NULL,
      amount             numeric(12,2) NOT NULL CHECK (amount >= 0),
      contribution_month date CHECK (contribution_month IS NULL OR extract(day from contribution_month) = 1),
      affiliation_year   integer CHECK (affiliation_year IS NULL OR affiliation_year BETWEEN 1900 AND 2100),
      date               date NOT NULL,
      note               text,
      recorded_by        uuid REFERENCES users(id) ON DELETE SET NULL,
      recorded_at        timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX contributions_member_category_date_idx
      ON contributions (member_id, category, date);
    CREATE INDEX contributions_event_idx ON contributions (event_id)
      WHERE event_id IS NOT NULL;
    CREATE INDEX contributions_month_idx ON contributions (member_id, contribution_month)
      WHERE contribution_month IS NOT NULL;
    CREATE INDEX contributions_affiliation_idx ON contributions (member_id, affiliation_year)
      WHERE affiliation_year IS NOT NULL;
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS contributions, attendance, events CASCADE;`);
};
