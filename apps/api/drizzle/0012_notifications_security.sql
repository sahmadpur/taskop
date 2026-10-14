DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_events','notifications','notification_deliveries','push_devices','notification_rules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Cleanup deletes old notifications and events, devices are removed at logout, rule overrides are reset (SP6 spec §5, §6.3).
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_events, notifications, notification_deliveries, push_devices, notification_rules TO taskop_app, taskop_platform;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS notification keys (new tenants get them at signup).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['notifications.manage','notifications.send']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'notifications.send' FROM roles r WHERE r.system_key = 'manager'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager');
--> statement-breakpoint
SET LOCAL row_security = on;
