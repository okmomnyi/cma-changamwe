exports.shorthands = undefined;

/**
 * Welfare support paid out, under by-laws section 5.3. Binds each decision to
 * the immutable snapshot it relied on, so an approval stays reproducible after
 * the live score moves on.
 *
 * The over-seven-days rule is a CHECK here because it is a condition of
 * payment. The under-18 rule cannot be: the date of birth lives on `children`,
 * so it is enforced when the claim is created.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE welfare_support_type AS ENUM (
      'pre_wedding','wedding_gift','sickness_advance',
      'benevolent_member_spouse','benevolent_child','benevolent_parent');

    CREATE TYPE welfare_claim_status AS ENUM (
      'pending','approved','rejected','paid','cancelled');

    CREATE TABLE welfare_claims (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id           uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      support_type        welfare_support_type NOT NULL,
      amount              numeric(12,2) NOT NULL CHECK (amount >= 0),
      status              welfare_claim_status NOT NULL DEFAULT 'pending',

      -- The standing relied on. period is the snapshot period; the remaining
      -- three are copied at decision time so the record stands on its own.
      period              text CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      matrix_score_id     uuid REFERENCES matrix_scores(id) ON DELETE RESTRICT,
      standing_relied_on  matrix_standing,
      score_relied_on     numeric(12,8),

      -- Supporting facts, by support type.
      subject_name        text,
      event_id            uuid REFERENCES events(id) ON DELETE RESTRICT,
      child_id            uuid REFERENCES children(id) ON DELETE RESTRICT,
      admitted_on         date,
      discharged_on       date,
      note                text,

      requested_at        timestamptz NOT NULL DEFAULT now(),
      requested_by        uuid REFERENCES users(id) ON DELETE SET NULL,
      decided_at          timestamptz,
      decided_by          uuid REFERENCES users(id) ON DELETE SET NULL,
      decision_note       text,
      paid_at             timestamptz,
      paid_by             uuid REFERENCES users(id) ON DELETE SET NULL,
      payment_reference   text,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT admission_dates_order CHECK (
        discharged_on IS NULL OR admitted_on IS NULL OR discharged_on >= admitted_on
      ),

      -- Section 5.3c: the advance applies to an admission of over seven days.
      CONSTRAINT sickness_needs_seven_days CHECK (
        support_type <> 'sickness_advance' OR (
          admitted_on IS NOT NULL AND discharged_on IS NOT NULL
          AND (discharged_on - admitted_on) > 7
        )
      ),

      -- A wedding payment names the wedding; a bereavement names the deceased.
      CONSTRAINT wedding_needs_event CHECK (
        support_type NOT IN ('pre_wedding','wedding_gift') OR event_id IS NOT NULL
      ),
      CONSTRAINT bereavement_needs_subject CHECK (
        support_type NOT IN ('benevolent_member_spouse','benevolent_child','benevolent_parent')
        OR subject_name IS NOT NULL
      ),
      CONSTRAINT child_claim_names_child CHECK (
        support_type <> 'benevolent_child' OR child_id IS NOT NULL
      ),

      -- A decided claim records who decided it, and when.
      CONSTRAINT decision_is_recorded CHECK (
        status IN ('pending','cancelled') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)
      ),
      CONSTRAINT payment_is_recorded CHECK (
        status <> 'paid' OR (paid_at IS NOT NULL AND paid_by IS NOT NULL)
      )
    );

    CREATE INDEX welfare_claims_member_idx  ON welfare_claims (member_id, requested_at DESC);
    CREATE INDEX welfare_claims_status_idx  ON welfare_claims (status, requested_at DESC);
    CREATE INDEX welfare_claims_period_idx  ON welfare_claims (period) WHERE period IS NOT NULL;

    -- One open claim per member per event, so a wedding gift is not paid twice.
    CREATE UNIQUE INDEX welfare_claims_one_per_member_event
      ON welfare_claims (member_id, support_type, event_id)
      WHERE event_id IS NOT NULL AND status <> 'rejected' AND status <> 'cancelled';
  `);

  pgm.sql(`
    INSERT INTO matrix_config (key, value, description) VALUES
      ('welfare_amounts',
        '{"pre_wedding":10000,"wedding_gift":5000,"sickness_advance":10000,
          "benevolent_member_spouse":100000,"benevolent_child":50000,
          "benevolent_parent":25000}'::jsonb,
        'By-laws section 5.3. Default KES amount offered for each support type.'),
      ('welfare_child_max_age', '18'::jsonb,
        'A benevolent child payment applies below this age in years.'),
      ('welfare_sickness_min_days', '7'::jsonb,
        'A sickness advance applies to an admission longer than this many days.')
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM matrix_config WHERE key IN
      ('welfare_amounts','welfare_child_max_age','welfare_sickness_min_days');
    DROP TABLE IF EXISTS welfare_claims CASCADE;
    DROP TYPE IF EXISTS welfare_claim_status, welfare_support_type;
  `);
};
