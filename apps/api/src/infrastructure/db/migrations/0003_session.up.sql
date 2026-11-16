CREATE TABLE user_session (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX ix_user_session_user ON user_session (user_id);
CREATE INDEX ix_user_session_expire ON user_session (expires_at);
