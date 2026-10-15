CREATE TYPE "public"."audit_report_status" AS ENUM('none', 'pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."audit_verdict" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."correction_kind" AS ENUM('manual', 'rework');--> statement-breakpoint
CREATE TABLE "audit_item_verdicts" (
	"tenant_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"verdict" "audit_verdict" NOT NULL,
	"comment" text,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_item_verdicts_pk" PRIMARY KEY("audit_id","item_id"),
	CONSTRAINT "audit_item_verdicts_comment_ck" CHECK ("audit_item_verdicts"."verdict" <> 'rejected' or "audit_item_verdicts"."comment" is not null)
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"status" "audit_status" DEFAULT 'in_progress' NOT NULL,
	"auditor_user_id" uuid,
	"auditor_platform_admin_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"result" "audit_result",
	"audit_score" jsonb,
	"comment" text,
	"report_status" "audit_report_status" DEFAULT 'none' NOT NULL,
	"report_storage_key" text,
	"report_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"report_sent_at" timestamp with time zone,
	"report_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audits_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "audits_auditor_ck" CHECK (num_nonnulls("audits"."auditor_user_id", "audits"."auditor_platform_admin_id") = 1),
	CONSTRAINT "audits_finished_ck" CHECK (("audits"."status" = 'finished') = ("audits"."finished_at" is not null and "audits"."result" is not null)),
	CONSTRAINT "audits_cancelled_ck" CHECK (("audits"."status" = 'cancelled') = ("audits"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "execution_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "correction_kind" NOT NULL,
	"round" integer NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"actor_user_id" uuid,
	"actor_platform_admin_id" uuid,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "execution_corrections_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "execution_corrections_actor_ck" CHECK (num_nonnulls("execution_corrections"."actor_user_id", "execution_corrections"."actor_platform_admin_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "execution_rework_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"items" jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"requested_by_user_id" uuid,
	"requested_by_platform_admin_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"answers_before" jsonb NOT NULL,
	"status_before" "occurrence_status" NOT NULL,
	"resubmitted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	CONSTRAINT "execution_rework_requests_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "execution_rework_requests_round_uq" UNIQUE("execution_id","round"),
	CONSTRAINT "execution_rework_requests_requester_ck" CHECK (num_nonnulls("execution_rework_requests"."requested_by_user_id", "execution_rework_requests"."requested_by_platform_admin_id") = 1),
	CONSTRAINT "execution_rework_requests_status_before_ck" CHECK ("execution_rework_requests"."status_before" in ('completed', 'audit_pending'))
);
--> statement-breakpoint
ALTER TABLE "execution_problems" DROP CONSTRAINT "execution_problems_item_uq";--> statement-breakpoint
ALTER TABLE "checklists" ADD COLUMN "requires_audit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checklists" ADD COLUMN "audit_report_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD COLUMN "cleared_by_correction_id" uuid;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "original_answers" jsonb;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "original_score" jsonb;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "original_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "rework_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD COLUMN "result_filter" text;--> statement-breakpoint
ALTER TABLE "audit_item_verdicts" ADD CONSTRAINT "audit_item_verdicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_item_verdicts" ADD CONSTRAINT "audit_item_verdicts_audit_fk" FOREIGN KEY ("tenant_id","audit_id") REFERENCES "public"."audits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_item_verdicts" ADD CONSTRAINT "audit_item_verdicts_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "public"."executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_occurrence_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_auditor_fk" FOREIGN KEY ("tenant_id","auditor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_corrections" ADD CONSTRAINT "execution_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_corrections" ADD CONSTRAINT "execution_corrections_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "public"."executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_corrections" ADD CONSTRAINT "execution_corrections_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_rework_requests" ADD CONSTRAINT "execution_rework_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_rework_requests" ADD CONSTRAINT "execution_rework_requests_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "public"."executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_rework_requests" ADD CONSTRAINT "execution_rework_requests_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_rework_requests" ADD CONSTRAINT "execution_rework_requests_withdrawn_by_fk" FOREIGN KEY ("tenant_id","withdrawn_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audits_open_uq" ON "audits" USING btree ("execution_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "audits_status_started_idx" ON "audits" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE INDEX "audits_status_finished_idx" ON "audits" USING btree ("tenant_id","status","finished_at");--> statement-breakpoint
CREATE INDEX "audits_occurrence_idx" ON "audits" USING btree ("tenant_id","occurrence_id");--> statement-breakpoint
CREATE INDEX "execution_corrections_execution_idx" ON "execution_corrections" USING btree ("tenant_id","execution_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_rework_requests_open_uq" ON "execution_rework_requests" USING btree ("execution_id") WHERE resubmitted_at is null and withdrawn_at is null;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_cleared_by_fk" FOREIGN KEY ("tenant_id","cleared_by_correction_id") REFERENCES "public"."execution_corrections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_problems_active_item_uq" ON "execution_problems" USING btree ("execution_id","item_id","source") WHERE cleared_at is null;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_result_filter_ck" CHECK ("notification_rules"."result_filter" is null or "notification_rules"."result_filter" in ('any', 'failed'));
--> statement-breakpoint
-- SP8 spec §4.1, BR-14: the original answers are written once, by the first correction or send-back, and never change.
CREATE FUNCTION executions_original_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.original_captured_at IS NOT NULL AND (
        NEW.original_answers IS DISTINCT FROM OLD.original_answers
        OR NEW.original_score IS DISTINCT FROM OLD.original_score
        OR NEW.original_captured_at IS DISTINCT FROM OLD.original_captured_at))
     OR (OLD.original_answers IS NOT NULL AND NEW.original_answers IS DISTINCT FROM OLD.original_answers) THEN
    RAISE EXCEPTION 'the original answers of execution % are immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER executions_original_immutable BEFORE UPDATE ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_original_guard();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['execution_corrections','execution_rework_requests','audits','audit_item_verdicts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Corrections are append-only (spec §4.2).
GRANT SELECT, INSERT ON execution_corrections TO taskop_app, taskop_platform;
--> statement-breakpoint
-- A send-back is closed by a resubmit or a withdrawal; nothing else of it ever changes.
GRANT SELECT, INSERT ON execution_rework_requests TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT UPDATE (resubmitted_at, withdrawn_at, withdrawn_by_user_id) ON execution_rework_requests TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Audits are never deleted; verdicts are cleared by the auditor and reset by a resubmit.
GRANT SELECT, INSERT, UPDATE ON audits TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_item_verdicts TO taskop_app, taskop_platform;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS keys (new tenants get them at signup); Admin roles hold every key.
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'executions.correct' FROM roles r WHERE r.system_key IN ('admin', 'manager')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'audits.perform' FROM roles r WHERE r.system_key IN ('admin', 'auditor')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager', 'auditor');
--> statement-breakpoint
SET LOCAL row_security = on;
