exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TYPE verification_purpose ADD VALUE IF NOT EXISTS 'login';`);
};

exports.down = () => {};
