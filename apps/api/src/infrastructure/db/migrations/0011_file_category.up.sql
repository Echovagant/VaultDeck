CREATE TABLE IF NOT EXISTS file_category_assignment (
  file_id uuid PRIMARY KEY,
  category_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fca_category ON file_category_assignment (category_id);
