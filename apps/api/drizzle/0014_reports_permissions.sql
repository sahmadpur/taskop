-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS report keys (new tenants get them at signup). Admin roles were seeded
-- with the permission list of their time, so they need the keys too (SP7 Spec decision 25).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['reports.view','reports.export']) AS k
  WHERE r.system_key IN ('admin', 'manager', 'auditor')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager', 'auditor');
--> statement-breakpoint
SET LOCAL row_security = on;
