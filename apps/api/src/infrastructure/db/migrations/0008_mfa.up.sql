ALTER TABLE app_user ADD COLUMN mfa_secret text;
ALTER TABLE app_user ADD COLUMN mfa_enabled_at timestamptz;
