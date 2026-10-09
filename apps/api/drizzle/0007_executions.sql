CREATE TYPE "public"."claim_rejection_reason" AS ENUM('ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT');--> statement-breakpoint
CREATE TYPE "public"."execution_state" AS ENUM('active', 'completed', 'partial', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('camera', 'gallery');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."problem_severity" AS ENUM('normal', 'critical');--> statement-breakpoint
CREATE TYPE "public"."problem_source" AS ENUM('rule', 'manual');--> statement-breakpoint
CREATE TABLE "execution_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" "media_kind" NOT NULL,
	"source" "media_source" NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_by_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"storage_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_media_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "execution_problems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source" "problem_source" NOT NULL,
	"severity" "problem_severity" NOT NULL,
	"note" text,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_problems_item_uq" UNIQUE("execution_id","item_id","source")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"checklist_version_id" uuid NOT NULL,
	"executor_user_id" uuid NOT NULL,
	"state" "execution_state" NOT NULL,
	"rejected_reason" "claim_rejection_reason",
	"started_at" timestamp with time zone NOT NULL,
	"started_received_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_received_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answers_rev" integer DEFAULT 0 NOT NULL,
	"progress" jsonb NOT NULL,
	"score" jsonb,
	"late" boolean DEFAULT false NOT NULL,
	"clock_offset_ms" integer,
	"clock_suspect" boolean DEFAULT false NOT NULL,
	"device" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "executions_rejected_ck" CHECK (("executions"."state" = 'rejected') = ("executions"."rejected_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "checklist_version_id" uuid;--> statement-breakpoint
ALTER TABLE "execution_media" ADD CONSTRAINT "execution_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_media" ADD CONSTRAINT "execution_media_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "public"."executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_media" ADD CONSTRAINT "execution_media_captured_by_fk" FOREIGN KEY ("tenant_id","captured_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "public"."executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_occurrence_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_checklist_fk" FOREIGN KEY ("tenant_id","checklist_id") REFERENCES "public"."checklists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_occurrence_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_version_fk" FOREIGN KEY ("tenant_id","checklist_version_id") REFERENCES "public"."checklist_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_executor_fk" FOREIGN KEY ("tenant_id","executor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_media_execution_idx" ON "execution_media" USING btree ("tenant_id","execution_id");--> statement-breakpoint
CREATE INDEX "execution_media_status_idx" ON "execution_media" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "execution_problems_site_idx" ON "execution_problems" USING btree ("tenant_id","site_id","created_at");--> statement-breakpoint
CREATE INDEX "execution_problems_severity_idx" ON "execution_problems" USING btree ("tenant_id","severity","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_claim_uq" ON "executions" USING btree ("occurrence_id") WHERE state <> 'rejected';--> statement-breakpoint
CREATE INDEX "executions_executor_idx" ON "executions" USING btree ("tenant_id","executor_user_id","started_at");--> statement-breakpoint
CREATE INDEX "executions_occurrence_idx" ON "executions" USING btree ("tenant_id","occurrence_id");--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_version_fk" FOREIGN KEY ("tenant_id","checklist_version_id") REFERENCES "public"."checklist_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;