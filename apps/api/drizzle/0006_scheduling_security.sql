DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts','shift_roster','assignments','assignment_assignees','occurrences','occurrence_assignees','occurrence_status_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Shifts, assignments and occurrences are never deleted; roster and snapshot rows are replaced.
GRANT SELECT, INSERT, UPDATE ON shifts, assignments, occurrences TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_roster, assignment_assignees, occurrence_assignees TO taskop_app, taskop_platform;
--> statement-breakpoint
-- FR-11.02: status history is append-only.
GRANT SELECT, INSERT ON occurrence_status_history TO taskop_app, taskop_platform;
--> statement-breakpoint
-- pg-boss keeps its job tables in their own schema, owned by the app account so it can install and upgrade them itself.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION taskop_app;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants: Admin gets the new keys (new tenants get them from SYSTEM_ROLE_DEFAULTS).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['assignments.view','assignments.manage','assignments.extended_window','shifts.view','shifts.manage']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key = 'admin';
--> statement-breakpoint
SET LOCAL row_security = on;
