exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TYPE marital_status       AS ENUM ('married','widowed','single');
    CREATE TYPE life_status          AS ENUM ('alive','deceased');
    CREATE TYPE membership_status    AS ENUM ('active','inactive','transferred','deceased');
    CREATE TYPE office_scope         AS ENUM ('parish','prayer_house');
    CREATE TYPE attendance_status    AS ENUM ('present','absent','apology');
    CREATE TYPE event_type           AS ENUM (
      'mass','dominica','prayer_house_meeting','novena','seminar','pilgrimage',
      'national_prayer_day','family_day','wedding','agm','special_general_meeting','other');
    CREATE TYPE contribution_category AS ENUM (
      'diocese_affiliation','deanery_affiliation','monthly_subscription','seminar_fee',
      'wedding','benevolent_member_spouse','benevolent_child','benevolent_parent',
      'sick_admission','sick_visitation','archbishop_support','other');
    CREATE TYPE matrix_category      AS ENUM ('spirituality','financial');
    CREATE TYPE matrix_source_kind   AS ENUM ('attendance','contribution');
    CREATE TYPE matrix_window_type   AS ENUM (
      'rolling_months','last_n_occurrences','last_n_series','mandatory','frequency');
    CREATE TYPE matrix_standing      AS ENUM (
      'in_good_standing','below_threshold','insufficient_history','ineligible_gate');
    CREATE TYPE email_send_status    AS ENUM ('pending','sent','failed');
    CREATE TYPE audit_entity_type    AS ENUM ('member','attendance','contribution','office','user','event');
    CREATE TYPE audit_action         AS ENUM ('create','update','delete');
    CREATE TYPE verification_purpose AS ENUM ('signup','email_change');

    CREATE TABLE prayer_houses (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL UNIQUE,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE members (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name               text NOT NULL,
      year_of_birth           integer NOT NULL CHECK (year_of_birth BETWEEN 1900 AND 2100),
      id_or_passport_no       text NOT NULL UNIQUE,
      mobile_no               text NOT NULL,
      home_parish_diocese     text,
      jumuiya                 text,
      prayer_house_id         uuid NOT NULL REFERENCES prayer_houses(id) ON DELETE RESTRICT,
      marital_status          marital_status NOT NULL,
      spouse_name             text,
      spouse_status           life_status,
      father_status           life_status,
      mother_status           life_status,
      next_of_kin_name        text NOT NULL,
      next_of_kin_id_no       text,
      next_of_kin_mobile      text NOT NULL,
      membership_status       membership_status NOT NULL DEFAULT 'active',
      profile_locked          boolean NOT NULL DEFAULT false,
      declaration_accepted_at timestamptz,
      created_at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX members_prayer_house_idx ON members (prayer_house_id);
    CREATE INDEX members_full_name_idx    ON members (lower(full_name));

    CREATE TABLE children (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      name          text NOT NULL,
      date_of_birth date,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX children_member_idx ON children (member_id);
  `);
};
exports.down = (pgm) => {
    pgm.sql(`
    DROP TABLE IF EXISTS children, members, prayer_houses CASCADE;
    DROP TYPE IF EXISTS verification_purpose, audit_action, audit_entity_type,
      email_send_status, matrix_standing, matrix_window_type, matrix_source_kind,
      matrix_category, contribution_category, event_type, attendance_status,
      office_scope, membership_status, life_status, marital_status;
  `);
};
