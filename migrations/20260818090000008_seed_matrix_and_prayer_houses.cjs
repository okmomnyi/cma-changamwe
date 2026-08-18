exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    INSERT INTO prayer_houses (name) VALUES
      ('Noor'),
      ('Railway/National Housing'),
      ('Malandi'),
      ('Magongo'),
      ('Chaani/Migadini'),
      ('Hamisi')
    ON CONFLICT (name) DO NOTHING;
  `);
    pgm.sql(`
    INSERT INTO matrix_config (key, value, description) VALUES
      ('org_name', '"CMA Changamwe"'::jsonb,
        'Display name on the portal, reports and exports.'),
      ('coordinator_label', '"Coordinator"'::jsonb,
        'Label shown for office_key=coordinator.'),
      ('admin_offices', '["coordinator","treasurer"]'::jsonb,
        'Offices whose sitting holders get administrative access.'),
      ('overall_min', '60'::jsonb,
        'Minimum total score for in_good_standing, out of 100.'),
      ('spirituality_min', '40'::jsonb,
        'Minimum spirituality subtotal when enforce_category_mins is true.'),
      ('financial_min', '20'::jsonb,
        'Minimum financial subtotal when enforce_category_mins is true.'),
      ('enforce_category_mins', 'true'::jsonb,
        'Enforce the category minimums in addition to overall_min.'),
      ('rescale_thresholds', 'true'::jsonb,
        'Rescale thresholds to the attainable total so unheld events do not penalise.'),
      ('min_attainable', '70'::jsonb,
        'Below this attainable total, standing is insufficient_history.'),
      ('expected_monthly', '100'::jsonb,
        'KES that must be reached for a month to count as satisfied.'),
      ('monthly_partial_satisfies', 'false'::jsonb,
        'When true, any payment satisfies the month instead of reaching expected_monthly.'),
      ('weddings_window_months', '12'::jsonb,
        'Rolling window in months for the weddings frequency rule.'),
      ('other_contribution_categories',
        '["deanery_affiliation","seminar_fee","archbishop_support","sick_admission","sick_visitation"]'::jsonb,
        'Categories counted by the other-contributions rule.'),
      ('bereavement_categories',
        '["benevolent_member_spouse","benevolent_child","benevolent_parent"]'::jsonb,
        'Categories counted as bereavement support.'),
      ('affiliation_min_amount', '1000'::jsonb,
        'KES diocese affiliation that must be paid for the current year.')
    ON CONFLICT (key) DO NOTHING;
  `);
    pgm.sql(`
    INSERT INTO matrix_rules
      (item_key, label, category, source_kind, source_filter,
       window_type, window_value, points, min_threshold_pct, hard_gate, sort_order)
    VALUES
      ('fridays', 'Fridays', 'spirituality', 'attendance',
        '{"event_matrix_item_key":"fridays"}'::jsonb,
        'rolling_months', 3, 15, 75, false, 10),

      ('dominica', 'Dominica', 'spirituality', 'attendance',
        '{"event_matrix_item_key":"dominica"}'::jsonb,
        'rolling_months', 6, 15, 75, false, 20),

      ('seminars', 'Seminars', 'spirituality', 'attendance',
        '{"event_matrix_item_key":"seminars"}'::jsonb,
        'last_n_occurrences', 3, 15, 75, false, 30),

      ('novena', 'Novena', 'spirituality', 'attendance',
        '{"event_matrix_item_key":"novena"}'::jsonb,
        'last_n_series', 3, 15, 75, false, 40),

      ('affiliation', 'Affiliation', 'financial', 'contribution',
        '{"categories":["diocese_affiliation"],"min_amount_config":"affiliation_min_amount","scope":"affiliation_year"}'::jsonb,
        'mandatory', NULL, 8, 100, false, 50),

      ('monthly', 'Monthly subscription', 'financial', 'contribution',
        '{"categories":["monthly_subscription"],"per":"month","expected_amount_config":"expected_monthly"}'::jsonb,
        'rolling_months', 6, 8, 60, false, 60),

      ('weddings', 'Weddings', 'financial', 'contribution',
        '{"categories":["wedding"],"occurrence_event_type":"wedding"}'::jsonb,
        'frequency', 12, 8, 60, false, 70),

      ('bereavement', 'Bereavement', 'financial', 'contribution',
        '{"categories_config":"bereavement_categories","occurrence_kind":"bereavement_drive"}'::jsonb,
        'last_n_occurrences', 3, 8, 60, false, 80),

      ('other', 'Other contributions', 'financial', 'contribution',
        '{"categories_config":"other_contribution_categories"}'::jsonb,
        'last_n_occurrences', 3, 8, 60, false, 90)
    ON CONFLICT (item_key) DO NOTHING;
  `);
};
exports.down = (pgm) => {
    pgm.sql(`
    DELETE FROM matrix_rules WHERE item_key IN
      ('fridays','dominica','seminars','novena','affiliation','monthly','weddings','bereavement','other');
    DELETE FROM matrix_config WHERE key IN
      ('org_name','coordinator_label','admin_offices','overall_min','spirituality_min',
       'financial_min','enforce_category_mins','rescale_thresholds','min_attainable',
       'expected_monthly','monthly_partial_satisfies','weddings_window_months',
       'other_contribution_categories','bereavement_categories','affiliation_min_amount');
    DELETE FROM prayer_houses WHERE name IN
      ('Noor','Railway/National Housing','Malandi','Magongo','Chaani/Migadini','Hamisi');
  `);
};
