CREATE TYPE "public"."checklist_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."checklist_version_state" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other');--> statement-breakpoint
CREATE TYPE "public"."template_source_kind" AS ENUM('global', 'tenant');--> statement-breakpoint
CREATE TABLE "checklist_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"state" "checklist_version_state" NOT NULL,
	"number" integer,
	"content" jsonb NOT NULL,
	"change_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"created_by_platform_admin_id" uuid,
	"published_by_user_id" uuid,
	"published_by_platform_admin_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_versions_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_versions_number_uq" UNIQUE("checklist_id","number"),
	CONSTRAINT "checklist_versions_creator_ck" CHECK (num_nonnulls("checklist_versions"."created_by_user_id", "checklist_versions"."created_by_platform_admin_id") = 1),
	CONSTRAINT "checklist_versions_published_ck" CHECK (("checklist_versions"."state" = 'draft' and "checklist_versions"."number" is null and "checklist_versions"."published_at" is null and "checklist_versions"."published_by_user_id" is null and "checklist_versions"."published_by_platform_admin_id" is null)
       or ("checklist_versions"."state" = 'published' and "checklist_versions"."number" is not null and "checklist_versions"."published_at" is not null and num_nonnulls("checklist_versions"."published_by_user_id", "checklist_versions"."published_by_platform_admin_id") = 1))
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "template_category",
	"status" "checklist_status" DEFAULT 'active' NOT NULL,
	"current_version_id" uuid,
	"latest_version_number" integer DEFAULT 0 NOT NULL,
	"source_template_kind" "template_source_kind",
	"source_template_id" uuid,
	"source_version_id" uuid,
	"created_by_user_id" uuid,
	"created_by_platform_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklists_creator_ck" CHECK (num_nonnulls("checklists"."created_by_user_id", "checklists"."created_by_platform_admin_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "global_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "template_category" NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"item_count" integer NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_platform_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "template_category" NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"item_count" integer NOT NULL,
	"status" "checklist_status" DEFAULT 'active' NOT NULL,
	"source_checklist_id" uuid,
	"source_version_id" uuid,
	"created_by_user_id" uuid,
	"created_by_platform_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_templates_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_templates_creator_ck" CHECK (num_nonnulls("tenant_templates"."created_by_user_id", "tenant_templates"."created_by_platform_admin_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_versions" ADD CONSTRAINT "checklist_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_versions" ADD CONSTRAINT "checklist_versions_checklist_fk" FOREIGN KEY ("tenant_id","checklist_id") REFERENCES "public"."checklists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_versions" ADD CONSTRAINT "checklist_versions_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_versions" ADD CONSTRAINT "checklist_versions_published_by_fk" FOREIGN KEY ("tenant_id","published_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_templates" ADD CONSTRAINT "global_templates_created_by_platform_admin_id_platform_admins_id_fk" FOREIGN KEY ("created_by_platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_versions_one_draft_uq" ON "checklist_versions" USING btree ("checklist_id") WHERE "checklist_versions"."state" = 'draft';--> statement-breakpoint
CREATE INDEX "checklist_versions_checklist_idx" ON "checklist_versions" USING btree ("tenant_id","checklist_id");--> statement-breakpoint
CREATE INDEX "checklists_tenant_idx" ON "checklists" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tenant_templates_tenant_idx" ON "tenant_templates" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_scope_ck" CHECK ("audit_log"."tenant_id" is not null or "audit_log"."actor_platform_admin_id" is not null);