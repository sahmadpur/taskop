DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','task_submissions','task_media','task_status_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tasks, submissions and media are never deleted (FR-04.11); task-media.cleanup purges objects and keeps rows.
GRANT SELECT, INSERT, UPDATE ON tasks, task_submissions, task_media TO taskop_app, taskop_platform;
--> statement-breakpoint
-- FR-14.09: status history is append-only.
GRANT SELECT, INSERT ON task_status_history TO taskop_app, taskop_platform;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS task keys (new tenants get them at signup).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['tasks.view','tasks.manage']) AS k
  WHERE r.system_key IN ('admin', 'manager')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'tasks.view' FROM roles r WHERE r.system_key = 'auditor'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager', 'auditor');
--> statement-breakpoint
SET LOCAL row_security = on;
