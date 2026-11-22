CREATE TABLE IF NOT EXISTS file_share (
  share_id uuid PRIMARY KEY,
  file_id uuid NOT NULL,
  project_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  download_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_file_share_token ON file_share (token_hash);
CREATE INDEX IF NOT EXISTS idx_file_share_creator ON file_share (created_by);
