exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS verification_subject;
    ALTER TABLE email_verifications ADD CONSTRAINT verification_subject CHECK (
      (purpose = 'signup'       AND draft_id IS NOT NULL AND user_id IS NULL) OR
      (purpose = 'email_change' AND user_id  IS NOT NULL AND new_email IS NOT NULL) OR
      (purpose = 'login'        AND user_id  IS NOT NULL)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM email_verifications WHERE purpose = 'login';
    ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS verification_subject;
    ALTER TABLE email_verifications ADD CONSTRAINT verification_subject CHECK (
      (purpose = 'signup'       AND draft_id IS NOT NULL AND user_id IS NULL) OR
      (purpose = 'email_change' AND user_id  IS NOT NULL AND new_email IS NOT NULL)
    );
  `);
};
