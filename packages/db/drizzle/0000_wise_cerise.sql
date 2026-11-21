CREATE TYPE "public"."block_parent_table" AS ENUM('block', 'collection', 'space');--> statement-breakpoint
CREATE TYPE "public"."collection_view_type" AS ENUM('table', 'board', 'calendar', 'timeline', 'gallery', 'list');--> statement-breakpoint
CREATE TYPE "public"."permission_role" AS ENUM('read', 'comment', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('user', 'teamspace', 'public');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workspace_members" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(64),
	"icon" text,
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"full_name" varchar(255) NOT NULL,
	"avatar_url" text,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"type" varchar(64) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"parent_id" uuid NOT NULL,
	"parent_table" "block_parent_table" NOT NULL,
	"alive" boolean DEFAULT true NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"last_edited_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "collection_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"type" "collection_view_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"format" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"query2" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alive" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"name" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text,
	"cover" text,
	"alive" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_table" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"principal_id" uuid,
	"role" "permission_role" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"request_id" uuid,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operations" jsonb NOT NULL,
	"versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_space_id_workspaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_last_edited_by_id_users_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_space_id_workspaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_space_id_workspaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_space_id_workspaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user_id" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_role" ON "workspace_members" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_domain" ON "workspaces" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_workspaces_created_at" ON "workspaces" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_accounts_provider_account" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_user_id" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_blocks_space_id" ON "blocks" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_parent_id" ON "blocks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_alive" ON "blocks" USING btree ("alive");--> statement-breakpoint
CREATE INDEX "idx_blocks_type" ON "blocks" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_blocks_space_parent" ON "blocks" USING btree ("space_id","parent_table","parent_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_last_edited" ON "blocks" USING btree ("space_id","last_edited_time");--> statement-breakpoint
CREATE INDEX "idx_blocks_properties_gin" ON "blocks" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "idx_blocks_format_gin" ON "blocks" USING gin ("format");--> statement-breakpoint
CREATE INDEX "idx_collection_views_coll_id" ON "collection_views" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_collection_views_space_id" ON "collection_views" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_collection_views_type" ON "collection_views" USING btree ("collection_id","type");--> statement-breakpoint
CREATE INDEX "idx_collection_views_query2_gin" ON "collection_views" USING gin ("query2");--> statement-breakpoint
CREATE INDEX "idx_collections_space_id" ON "collections" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_collections_parent_id" ON "collections" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_collections_schema_gin" ON "collections" USING gin ("schema");--> statement-breakpoint
CREATE INDEX "idx_permissions_entity" ON "permissions" USING btree ("entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_principal" ON "permissions" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_workspace" ON "permissions" USING btree ("workspace_id","entity_table");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tx_records_transaction_id" ON "transaction_records" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_tx_records_space_created" ON "transaction_records" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tx_records_user_created" ON "transaction_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tx_records_request_id" ON "transaction_records" USING btree ("request_id");