exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE audit_log (
      id            bigserial PRIMARY KEY,
      entity_type   audit_entity_type NOT NULL,
      entity_id     uuid,
      action        audit_action NOT NULL,
      field_changed text,
      old_value     text,
      new_value     text,
      changed_by    uuid REFERENCES users(id) ON DELETE RESTRICT,
      changed_at    timestamptz NOT NULL DEFAULT now(),
      request_id    text,
      ip_address    inet
    );
    CREATE INDEX audit_log_entity_idx     ON audit_log (entity_type, entity_id);
    CREATE INDEX audit_log_changed_at_idx ON audit_log (changed_at DESC);
    CREATE INDEX audit_log_actor_idx      ON audit_log (changed_by, changed_at DESC);

    CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
    END;
    $fn$;

    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

    CREATE TRIGGER audit_log_no_delete
      BEFORE DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

    CREATE TRIGGER audit_log_no_truncate
      BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
  `);
};
exports.down = (pgm) => {
    pgm.sql(`
    DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
    DROP TRIGGER IF EXISTS audit_log_no_delete   ON audit_log;
    DROP TRIGGER IF EXISTS audit_log_no_update   ON audit_log;
    DROP FUNCTION IF EXISTS audit_log_is_append_only();
    DROP TABLE IF EXISTS audit_log CASCADE;
  `);
};
