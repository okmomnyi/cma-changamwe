exports.shorthands = undefined;

/**
 * Enum values must be added outside a transaction: one added inside cannot be
 * used until it commits. The new event types are programmes the by-laws name
 * but nothing could record. None feed the Matrix.
 */
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'choir';`);
  pgm.sql(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'act_of_mercy';`);
  pgm.sql(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'mentorship';`);
  pgm.sql(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'sports';`);
  pgm.sql(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'shg_activity';`);
  pgm.sql(`ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'welfare_claim';`);
  pgm.sql(`ALTER TYPE verification_purpose ADD VALUE IF NOT EXISTS 'password_reset';`);
};

exports.down = () => {};
