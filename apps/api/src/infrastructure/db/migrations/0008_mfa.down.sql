ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_enabled_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_secret;
