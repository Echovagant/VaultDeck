DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
DROP FUNCTION IF EXISTS forbid_audit_mutation();

DROP TABLE IF EXISTS setting;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS file;
DROP TABLE IF EXISTS stored_object;
DROP TABLE IF EXISTS folder;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS project_member;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS app_user;
DROP TABLE IF EXISTS role;
