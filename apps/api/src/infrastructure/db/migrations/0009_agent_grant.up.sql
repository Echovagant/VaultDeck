CREATE TABLE IF NOT EXISTS agent_grant (
  grant_id uuid PRIMARY KEY,
  name text NOT NULL,
  role_code text NOT NULL CHECK (role_code IN ('DEPUTY_LEADER', 'MEMBER')),
  scope_all boolean NOT NULL DEFAULT false,
  project_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_only boolean NOT NULL DEFAULT true,
  code_hash text NOT NULL,
  code_used boolean NOT NULL DEFAULT false,
  code_expires_at timestamptz NOT NULL,
  token_hash text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_grant_code_hash ON agent_grant (code_hash);
CREATE INDEX IF NOT EXISTS idx_agent_grant_token_hash ON agent_grant (token_hash);
