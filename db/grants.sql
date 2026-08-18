DO $grants$
DECLARE
  app_role text := current_setting('cma.app_role');
  app_pw   text := nullif(current_setting('cma.app_password', true), '');
  db_name  text := current_database();
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'cma.app_role must be set before applying grants';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    IF app_pw IS NULL THEN
      RAISE EXCEPTION 'role % does not exist and no cma.app_password was supplied', app_role;
    END IF;
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', app_role, app_pw);
    RAISE NOTICE 'created role %', app_role;
  ELSIF app_pw IS NOT NULL THEN
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', app_role, app_pw);
  END IF;

  EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', app_role);
  EXECUTE  'REVOKE CREATE ON SCHEMA public FROM PUBLIC';

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db_name, app_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);

  EXECUTE format('REVOKE ALL ON TABLE audit_log FROM %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE audit_log TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO %I', app_role);

  EXECUTE format('REVOKE ALL ON TABLE matrix_scores FROM %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE matrix_scores TO %I', app_role);
  EXECUTE format('GRANT UPDATE (email_status, sent_at) ON TABLE matrix_scores TO %I', app_role);

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pgmigrations') THEN
    EXECUTE format('REVOKE ALL ON TABLE pgmigrations FROM %I', app_role);
    EXECUTE format('GRANT SELECT ON TABLE pgmigrations TO %I', app_role);
  END IF;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    app_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
    app_role);

  RAISE NOTICE 'grants applied for role %', app_role;
END
$grants$;
