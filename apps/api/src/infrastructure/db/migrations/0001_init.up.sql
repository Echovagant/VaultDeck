CREATE TABLE role (
  role_code text PRIMARY KEY,
  role_name text NOT NULL
);

CREATE TABLE app_user (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  role_code text NOT NULL REFERENCES role (role_code),
  status text NOT NULL DEFAULT 'active',
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_app_user_username_lower ON app_user (lower(username));

CREATE TABLE project (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL,
  project_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_project_code_lower ON project (lower(project_code));

CREATE TABLE project_member (
  project_id uuid NOT NULL REFERENCES project (project_id),
  user_id uuid NOT NULL REFERENCES app_user (user_id),
  member_role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE category (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  category_name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_category_code_lower ON category (lower(category_code));

CREATE TABLE folder (
  folder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project (project_id),
  parent_id uuid REFERENCES folder (folder_id),
  folder_name text NOT NULL,
  depth integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app_user (user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_folder_sibling_name_lower ON folder (
  project_id,
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(folder_name)
);

CREATE TABLE stored_object (
  object_id text PRIMARY KEY,
  sha256 char(64) NOT NULL UNIQUE,
  size_bytes bigint NOT NULL,
  rel_path text NOT NULL,
  ref_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file (
  file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project (project_id),
  folder_id uuid NOT NULL REFERENCES folder (folder_id),
  category_id uuid REFERENCES category (category_id),
  object_id text REFERENCES stored_object (object_id),
  file_name text NOT NULL,
  extension text,
  size_bytes bigint NOT NULL,
  content_type text,
  uploader_id uuid NOT NULL REFERENCES app_user (user_id),
  status text NOT NULL DEFAULT 'active',
  trashed_at timestamptz,
  expire_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_file_project_status ON file (project_id, status);
CREATE INDEX ix_file_uploader ON file (uploader_id);

CREATE TABLE audit_log (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  result text NOT NULL,
  detail text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_occurred ON audit_log (occurred_at DESC);

CREATE TABLE setting (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log 只允许追加';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
