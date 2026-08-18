exports.shorthands = undefined;
exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE email_verifications (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
      draft_id    uuid,
      purpose     verification_purpose NOT NULL,
      code_hash   text NOT NULL,
      new_email   text,
      expires_at  timestamptz NOT NULL,
      consumed_at timestamptz,
      attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT verification_subject CHECK (
        (purpose = 'signup'       AND draft_id IS NOT NULL AND user_id IS NULL) OR
        (purpose = 'email_change' AND user_id  IS NOT NULL AND new_email IS NOT NULL)
      )
    );
    CREATE INDEX email_verifications_user_idx  ON email_verifications (user_id, purpose, created_at DESC);
    CREATE INDEX email_verifications_draft_idx ON email_verifications (draft_id, created_at DESC);

    CREATE TABLE password_resets (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  text NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

    CREATE TABLE signup_drafts (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email            text NOT NULL,
      draft_token_hash text NOT NULL UNIQUE,
      data_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
      current_step     integer NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
      email_verified   boolean NOT NULL DEFAULT false,
      promoted_at      timestamptz,
      expires_at       timestamptz NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX signup_drafts_email_idx   ON signup_drafts (lower(email));
    CREATE INDEX signup_drafts_expiry_idx  ON signup_drafts (expires_at);

    CREATE TABLE refresh_tokens (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id     uuid NOT NULL,
      token_hash    text NOT NULL UNIQUE,
      expires_at    timestamptz NOT NULL,
      revoked_at    timestamptz,
      replaced_by   uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
      user_agent    text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX refresh_tokens_user_idx   ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
    CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
  `);
};
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS refresh_tokens, signup_drafts, password_resets, email_verifications CASCADE;`);
};
