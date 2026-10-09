CREATE TYPE "public"."assignment_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited');--> statement-breakpoint
CREATE TABLE "assignment_assignees" (
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "assignment_assignees_assignment_id_user_id_pk" PRIMARY KEY("assignment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text,
	"schedule" jsonb NOT NULL,
	"timing" jsonb NOT NULL,
	"shift_id" uuid,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"materialized_until" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_by_platform_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "assignments_creator_ck" CHECK (num_nonnulls("assignments"."created_by_user_id", "assignments"."created_by_platform_admin_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "occurrence_assignees" (
	"tenant_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "occurrence_assignees_occurrence_id_user_id_pk" PRIMARY KEY("occurrence_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "occurrence_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"from_status" "occurrence_status",
	"to_status" "occurrence_status" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid,
	"actor_platform_admin_id" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"shift_id" uuid,
	"local_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" "occurrence_status" DEFAULT 'pending' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrences_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "occurrences_window_ck" CHECK ("occurrences"."starts_at" <= "occurrences"."due_at" and "occurrences"."due_at" <= "occurrences"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "shift_roster" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "shift_roster_user_id_shift_id_site_id_date_pk" PRIMARY KEY("user_id","shift_id","site_id","date")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"site_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "shifts_nonzero_ck" CHECK ("shifts"."start_time" <> "shifts"."end_time")
);
--> statement-breakpoint
ALTER TABLE "assignment_assignees" ADD CONSTRAINT "assignment_assignees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_assignees" ADD CONSTRAINT "assignment_assignees_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."assignments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_assignees" ADD CONSTRAINT "assignment_assignees_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_checklist_fk" FOREIGN KEY ("tenant_id","checklist_id") REFERENCES "public"."checklists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_assignees" ADD CONSTRAINT "occurrence_assignees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_assignees" ADD CONSTRAINT "occurrence_assignees_occurrence_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_assignees" ADD CONSTRAINT "occurrence_assignees_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_status_history" ADD CONSTRAINT "occurrence_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_status_history" ADD CONSTRAINT "occurrence_status_history_occurrence_fk" FOREIGN KEY ("tenant_id","occurrence_id") REFERENCES "public"."occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."assignments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_checklist_fk" FOREIGN KEY ("tenant_id","checklist_id") REFERENCES "public"."checklists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_assignees_user_idx" ON "assignment_assignees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "assignments_site_idx" ON "assignments" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "assignments_checklist_idx" ON "assignments" USING btree ("tenant_id","checklist_id");--> statement-breakpoint
CREATE INDEX "occurrence_assignees_user_idx" ON "occurrence_assignees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "occurrence_status_history_occurrence_idx" ON "occurrence_status_history" USING btree ("tenant_id","occurrence_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_live_day_uq" ON "occurrences" USING btree ("assignment_id","local_date") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "occurrences_site_start_idx" ON "occurrences" USING btree ("tenant_id","site_id","starts_at");--> statement-breakpoint
CREATE INDEX "occurrences_status_due_idx" ON "occurrences" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "occurrences_status_close_idx" ON "occurrences" USING btree ("tenant_id","status","closes_at");--> statement-breakpoint
CREATE INDEX "occurrences_assignment_start_idx" ON "occurrences" USING btree ("tenant_id","assignment_id","starts_at");--> statement-breakpoint
CREATE INDEX "shift_roster_site_date_idx" ON "shift_roster" USING btree ("tenant_id","site_id","date");--> statement-breakpoint
CREATE INDEX "shifts_tenant_idx" ON "shifts" USING btree ("tenant_id");