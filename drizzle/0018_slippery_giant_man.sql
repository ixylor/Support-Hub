CREATE TABLE "deleted_google_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_address" text NOT NULL,
	"provider_thread_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "deleted_google_threads_mailbox_thread_idx" ON "deleted_google_threads" USING btree ("mailbox_address","provider_thread_id");
