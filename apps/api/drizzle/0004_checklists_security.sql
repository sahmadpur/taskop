ALTER TABLE checklists
  ADD CONSTRAINT checklists_current_version_fk FOREIGN KEY (tenant_id, current_version_id) REFERENCES checklist_versions (tenant_id, id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklists','checklist_versions','tenant_templates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON checklists, tenant_templates TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_versions TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON global_templates TO taskop_platform;
--> statement-breakpoint
CREATE VIEW global_templates_published AS
  SELECT id, name, description, category, content, revision, item_count, sort_order, created_at, updated_at
  FROM global_templates WHERE published;
--> statement-breakpoint
GRANT SELECT ON global_templates_published TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Published versions are immutable (NFR-06, FR-06.11); only drafts may be updated or deleted.
CREATE FUNCTION checklist_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'published checklist versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER checklist_versions_immutable BEFORE UPDATE OR DELETE ON checklist_versions
  FOR EACH ROW EXECUTE FUNCTION checklist_versions_guard();
--> statement-breakpoint
-- The backfill below must see every tenant's rows. roles/role_permissions are FORCE RLS, so a migrator that
-- is RLS-subject (e.g. a non-superuser table owner) would silently match 0 rows. With row_security off,
-- Postgres raises an error instead of filtering; superusers and BYPASSRLS roles are unaffected.
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants: Admin gets the new keys (new tenants get them from SYSTEM_ROLE_DEFAULTS).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['checklists.view','checklists.manage','checklists.publish','templates.manage']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key = 'admin';
--> statement-breakpoint
-- Restore the default for any later statements in the same migration transaction.
SET LOCAL row_security = on;
