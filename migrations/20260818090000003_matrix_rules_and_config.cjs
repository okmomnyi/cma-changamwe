exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE matrix_rules (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_key         text NOT NULL UNIQUE CHECK (item_key ~ '^[a-z][a-z0-9_]{1,48}$'),
      label            text NOT NULL,
      category         matrix_category NOT NULL,
      source_kind      matrix_source_kind NOT NULL,
      source_filter    jsonb NOT NULL DEFAULT '{}'::jsonb,
      window_type      matrix_window_type NOT NULL,
      window_value     integer CHECK (window_value IS NULL OR window_value > 0),
      points           numeric(6,3) NOT NULL CHECK (points >= 0),
      min_threshold_pct numeric(5,2) NOT NULL CHECK (min_threshold_pct BETWEEN 0 AND 100),
      hard_gate        boolean NOT NULL DEFAULT false,
      active           boolean NOT NULL DEFAULT true,
      sort_order       integer NOT NULL DEFAULT 0,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT window_value_required CHECK (
        (window_type = 'mandatory' AND window_value IS NULL) OR
        (window_type <> 'mandatory' AND window_value IS NOT NULL)
      )
    );

    CREATE TABLE matrix_config (
      key         text PRIMARY KEY,
      value       jsonb NOT NULL,
      description text,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS matrix_config, matrix_rules CASCADE;`);
};
