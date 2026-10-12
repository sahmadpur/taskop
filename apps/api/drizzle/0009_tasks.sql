CREATE TYPE "public"."task_media_role" AS ENUM('instruction', 'response');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('new', 'accepted', 'in_progress', 'awaiting_review', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "task_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"submission_id" uuid,
	"role" "task_media_role" NOT NULL,
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
	CONSTRAINT "task_media_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status" "task_status",
	"to_status" "task_status" NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"review_decision" "task_review_decision",
	"review_comment" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "task_submissions_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"site_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"assignee_team_id" uuid,
	"requires_review" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '{"photo":"optional","video":"optional","liveOnly":false}'::jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"overdue_at" timestamp with time zone,
	"problem_id" uuid,
	"status" "task_status" DEFAULT 'new' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_problem_uq" UNIQUE("problem_id"),
	CONSTRAINT "tasks_assignee_ck" CHECK ("tasks"."assignee_user_id" is not null or "tasks"."assignee_team_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "execution_problems" ADD CONSTRAINT "execution_problems_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "task_media" ADD CONSTRAINT "task_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_media" ADD CONSTRAINT "task_media_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_media" ADD CONSTRAINT "task_media_submission_fk" FOREIGN KEY ("tenant_id","submission_id") REFERENCES "public"."task_submissions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_media" ADD CONSTRAINT "task_media_captured_by_fk" FOREIGN KEY ("tenant_id","captured_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_reviewed_by_fk" FOREIGN KEY ("tenant_id","reviewed_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_fk" FOREIGN KEY ("tenant_id","assignee_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_team_fk" FOREIGN KEY ("tenant_id","assignee_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_problem_fk" FOREIGN KEY ("tenant_id","problem_id") REFERENCES "public"."execution_problems"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_media_task_idx" ON "task_media" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "task_media_status_idx" ON "task_media" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "task_status_history_task_idx" ON "task_status_history" USING btree ("tenant_id","task_id","at");--> statement-breakpoint
CREATE INDEX "task_submissions_task_idx" ON "task_submissions" USING btree ("tenant_id","task_id","received_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_user_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_team_idx" ON "tasks" USING btree ("tenant_id","assignee_team_id") WHERE assignee_user_id is null;--> statement-breakpoint
CREATE INDEX "tasks_site_idx" ON "tasks" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("tenant_id","due_at") WHERE status not in ('completed', 'cancelled');--> statement-breakpoint
CREATE INDEX "tasks_sync_idx" ON "tasks" USING btree ("tenant_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "tasks_created_idx" ON "tasks" USING btree ("tenant_id","created_at","id");