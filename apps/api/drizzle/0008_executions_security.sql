DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['executions','execution_media','execution_problems']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Executions and media are never deleted (SP4 spec §5.3); a never-uploaded medium keeps its row.
GRANT SELECT, INSERT, UPDATE ON executions, execution_media TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Problems are derived from the answers and rewritten on every accepted save while the execution is active.
GRANT SELECT, INSERT, UPDATE, DELETE ON execution_problems TO taskop_app, taskop_platform;
