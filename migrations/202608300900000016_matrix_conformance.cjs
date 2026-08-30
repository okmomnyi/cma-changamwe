exports.shorthands = undefined;

/**
 * Brings the seeded Matrix into line with the orientation document of
 * 1st August 2026: Fridays scored over six months not three, section 6 amounts
 * applied to occurrence-based rules, the item relabelled (the key stays
 * `fridays` so recorded events keep scoring), and the Secretary given
 * administrative access.
 */
exports.up = (pgm) => {
  // A1
  pgm.sql(`
    UPDATE matrix_rules SET window_value = 6, updated_at = now()
     WHERE item_key = 'fridays' AND window_type = 'rolling_months';
  `);

  // A6
  pgm.sql(`
    UPDATE matrix_rules SET label = 'Weekly mass', updated_at = now()
     WHERE item_key = 'fridays' AND label = 'Fridays';
  `);

  // A2. Categories left out of this map carry no floor, so any payment counts.
  // Sick visitation is toa ndugu and Archbishop support is a donation or
  // harambee, so neither has a fixed amount to hold members to.
  pgm.sql(`
    INSERT INTO matrix_config (key, value, description) VALUES
      ('contribution_expected_amounts',
        '{"benevolent_member_spouse":1000,"benevolent_child":500,
          "benevolent_parent":250,"wedding":200,"deanery_affiliation":200,
          "seminar_fee":150,"sick_admission":100}'::jsonb,
        'By-laws section 6. Minimum KES for a contribution to count toward an occurrence.')
    ON CONFLICT (key) DO NOTHING;
  `);

  // B3
  pgm.sql(`
    UPDATE matrix_config
       SET value = '["coordinator","treasurer","secretary"]'::jsonb,
           updated_at = now()
     WHERE key = 'admin_offices'
       AND value = '["coordinator","treasurer"]'::jsonb;
  `);

  pgm.sql(`
    UPDATE matrix_config
       SET description = 'Offices whose sitting parish holders get administrative access. Prayer-house terms never confer it.'
     WHERE key = 'admin_offices';
  `);

  // B5. Section 3.2: officials serve three years, to a maximum of two terms.
  pgm.sql(`
    INSERT INTO matrix_config (key, value, description) VALUES
      ('office_term_years', '3'::jsonb,
        'By-laws section 3.2. Length of an elected term, used to flag terms that are due.'),
      ('office_max_terms', '2'::jsonb,
        'By-laws section 3.2. Terms one member may serve in the same office before standing down.')
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE matrix_config SET value = '["coordinator","treasurer"]'::jsonb
     WHERE key = 'admin_offices';
    DELETE FROM matrix_config WHERE key IN ('contribution_expected_amounts','office_term_years','office_max_terms');
    UPDATE matrix_rules SET label = 'Fridays' WHERE item_key = 'fridays';
    UPDATE matrix_rules SET window_value = 3 WHERE item_key = 'fridays';
  `);
};
