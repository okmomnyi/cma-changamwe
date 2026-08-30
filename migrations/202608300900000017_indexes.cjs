exports.shorthands = undefined;

/**
 * Two gaps. The Matrix filters contributions on category and date with no
 * member in the predicate, so `(member_id, category, date)` cannot serve it.
 * And fourteen foreign keys had no index, which Postgres does not add itself.
 *
 * Not CONCURRENTLY: these run inside the migration transaction, the tables are
 * small, and a failed concurrent build leaves an invalid index behind.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Query-driven.
    -- The occurrence list for bereavement, weddings and other contributions.
    CREATE INDEX IF NOT EXISTS contributions_category_date_idx
      ON contributions (category, date);

    -- The weddings rule selects events of one type inside a rolling window.
    CREATE INDEX IF NOT EXISTS events_type_date_idx
      ON events (type, date);

    -- Prayer-house office lookups, which the scope-aware authorization and the
    -- handover both go through.
    CREATE INDEX IF NOT EXISTS office_holders_prayer_house_idx
      ON office_holders (prayer_house_id) WHERE prayer_house_id IS NOT NULL;

    -- Foreign keys, on the tables that grow.
    CREATE INDEX IF NOT EXISTS attendance_recorded_by_idx
      ON attendance (recorded_by) WHERE recorded_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS contributions_recorded_by_idx
      ON contributions (recorded_by) WHERE recorded_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS events_created_by_idx
      ON events (created_by) WHERE created_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS events_prayer_house_idx
      ON events (prayer_house_id) WHERE prayer_house_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS member_photos_uploaded_by_idx
      ON member_photos (uploaded_by) WHERE uploaded_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS refresh_tokens_replaced_by_idx
      ON refresh_tokens (replaced_by) WHERE replaced_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS photo_upload_grants_issued_by_idx
      ON photo_upload_grants (issued_by) WHERE issued_by IS NOT NULL;

    -- Foreign keys on welfare claims. The table stays small, but the list view
    -- joins every one of these, and a claim must never block a parent delete
    -- silently by scanning.
    CREATE INDEX IF NOT EXISTS welfare_claims_event_idx
      ON welfare_claims (event_id) WHERE event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS welfare_claims_child_idx
      ON welfare_claims (child_id) WHERE child_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS welfare_claims_score_idx
      ON welfare_claims (matrix_score_id) WHERE matrix_score_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS welfare_claims_requested_by_idx
      ON welfare_claims (requested_by) WHERE requested_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS welfare_claims_decided_by_idx
      ON welfare_claims (decided_by) WHERE decided_by IS NOT NULL;
    CREATE INDEX IF NOT EXISTS welfare_claims_paid_by_idx
      ON welfare_claims (paid_by) WHERE paid_by IS NOT NULL;

    -- The roster, the register and every recalculation read only active members.
    CREATE INDEX IF NOT EXISTS members_active_idx
      ON members (prayer_house_id, full_name) WHERE membership_status = 'active';
  `);

  // The planner has no statistics for the new shapes until it is told.
  pgm.sql(`ANALYZE contributions, events, office_holders, members, attendance;`);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS members_active_idx;
    DROP INDEX IF EXISTS welfare_claims_paid_by_idx;
    DROP INDEX IF EXISTS welfare_claims_decided_by_idx;
    DROP INDEX IF EXISTS welfare_claims_requested_by_idx;
    DROP INDEX IF EXISTS welfare_claims_score_idx;
    DROP INDEX IF EXISTS welfare_claims_child_idx;
    DROP INDEX IF EXISTS welfare_claims_event_idx;
    DROP INDEX IF EXISTS photo_upload_grants_issued_by_idx;
    DROP INDEX IF EXISTS refresh_tokens_replaced_by_idx;
    DROP INDEX IF EXISTS member_photos_uploaded_by_idx;
    DROP INDEX IF EXISTS events_prayer_house_idx;
    DROP INDEX IF EXISTS events_created_by_idx;
    DROP INDEX IF EXISTS contributions_recorded_by_idx;
    DROP INDEX IF EXISTS attendance_recorded_by_idx;
    DROP INDEX IF EXISTS office_holders_prayer_house_idx;
    DROP INDEX IF EXISTS events_type_date_idx;
    DROP INDEX IF EXISTS contributions_category_date_idx;
  `);
};
