ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_ck" CHECK ("users"."locale" in ('az', 'en', 'ru'));