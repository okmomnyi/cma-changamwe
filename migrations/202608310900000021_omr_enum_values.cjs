exports.shorthands = undefined;

/**
 * Phase 9. Enum values must be added outside a transaction, so they arrive in
 * their own migration ahead of the tables that use them.
 *
 * An attendance sheet is a document like any other the association issues: it
 * carries a verification code in its footer and is sealed when it is made.
 */
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TYPE document_kind     ADD VALUE IF NOT EXISTS 'attendance_sheet';`);
  pgm.sql(`ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'attendance_sheet';`);
  pgm.sql(`ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'attendance_scan';`);
};

exports.down = () => {};
