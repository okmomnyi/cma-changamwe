exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE matrix_scores (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id          uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      period             text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      spirituality_score numeric(12,8) NOT NULL,
      financial_score    numeric(12,8) NOT NULL,
      total_score        numeric(12,8) NOT NULL,
      attainable_total   numeric(12,8) NOT NULL,
      standing           matrix_standing NOT NULL,
      breakdown_json     jsonb NOT NULL,
      generated_at       timestamptz NOT NULL DEFAULT now(),
      email_status       email_send_status NOT NULL DEFAULT 'pending',
      sent_at            timestamptz,
      CONSTRAINT matrix_scores_member_period_key UNIQUE (member_id, period)
    );
    CREATE INDEX matrix_scores_member_period_idx ON matrix_scores (member_id, period);
    CREATE INDEX matrix_scores_pending_idx ON matrix_scores (period, email_status)
      WHERE email_status = 'pending';
    CREATE INDEX matrix_scores_standing_idx ON matrix_scores (period, standing);
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS matrix_scores CASCADE;`);
};
