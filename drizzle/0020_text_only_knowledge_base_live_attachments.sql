-- Keep the already extracted text and indexed chunks for existing entries.
-- Uploads that never produced any text cannot be retained as useful articles.
DELETE FROM "kb_entries" WHERE "content" IS NULL OR btrim("content") = '';
UPDATE "kb_entries" SET "source_type" = 'article';
ALTER TABLE "kb_entries" ALTER COLUMN "content" SET NOT NULL;
ALTER TABLE "kb_entries" DROP COLUMN "storage_path";
ALTER TABLE "kb_entries" DROP COLUMN "original_filename";
ALTER TABLE "kb_entries" DROP COLUMN "content_type";
ALTER TABLE "kb_entries" DROP COLUMN "size_bytes";

ALTER TYPE "kb_source_type" RENAME TO "kb_source_type_old";
CREATE TYPE "kb_source_type" AS ENUM('article');
ALTER TABLE "kb_entries"
  ALTER COLUMN "source_type" TYPE "kb_source_type"
  USING "source_type"::text::"kb_source_type";
DROP TYPE "kb_source_type_old";

-- Existing metadata remains in place. Provider ids are nullable so older rows
-- remain visible even though they cannot be fetched live from the mailbox.
ALTER TABLE "attachments" DROP COLUMN "storage_path";
ALTER TABLE "attachments" ADD COLUMN "provider_attachment_id" text;

DELETE FROM "ai_deployments" WHERE "role" = 'extraction';
ALTER TYPE "ai_deployment_role" RENAME TO "ai_deployment_role_old";
CREATE TYPE "ai_deployment_role" AS ENUM('chat', 'embedding');
ALTER TABLE "ai_deployments"
  ALTER COLUMN "role" TYPE "ai_deployment_role"
  USING "role"::text::"ai_deployment_role";
DROP TYPE "ai_deployment_role_old";
