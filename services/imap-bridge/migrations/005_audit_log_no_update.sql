-- 005 — audit_log immutability hardened (Phase 5 Step 4).
-- Applied 2026-04-13 on nexamail.
--
-- 003 blocked DELETE and TRUNCATE. This migration blocks UPDATE too,
-- reusing the same exception-raising trigger function, so audit_log rows
-- are fully immutable once written. "Ownership transfer" must insert a
-- new row rather than rewrite history.

DROP TRIGGER IF EXISTS audit_log_prevent_update ON audit_log;

CREATE TRIGGER audit_log_prevent_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_no_delete();
