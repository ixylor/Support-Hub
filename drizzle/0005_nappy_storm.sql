CREATE TYPE "public"."ai_deployment_role" AS ENUM('chat', 'embedding', 'extraction');--> statement-breakpoint
CREATE TYPE "public"."kb_source_type" AS ENUM('pdf', 'docx', 'text', 'markdown', 'article');--> statement-breakpoint
CREATE TYPE "public"."kb_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "ai_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "ai_deployment_role" NOT NULL,
	"deployment_name" text NOT NULL,
	"model_name" text NOT NULL,
	"dimensions" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" DROP CONSTRAINT "kb_chunks_kb_entry_id_kb_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "kb_entries" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "source_type" "kb_source_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "status" "kb_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "uploaded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_deployments_one_active_per_role" ON "ai_deployments" USING btree ("role") WHERE "ai_deployments"."is_active" = true;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_kb_entry_id_kb_entries_id_fk" FOREIGN KEY ("kb_entry_id") REFERENCES "public"."kb_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD CONSTRAINT "kb_entries_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_chunks_search_vector_idx" ON "kb_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_entry_idx" ON "kb_chunks" USING btree ("kb_entry_id");--> statement-breakpoint
CREATE INDEX "kb_entries_tags_idx" ON "kb_entries" USING gin ("tags");