import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

// Read lazily (not as a module-level const) so tests can stub the env var
// per-test via vi.stubEnv + vi.resetModules.
function attachmentsDir(): string {
  return process.env.ATTACHMENTS_DIR ?? "./storage/attachments";
}

export async function saveAttachment(
  providerMessageId: string,
  filename: string,
  content: Buffer
): Promise<string> {
  // Sanitize providerMessageId: extract basename, reject empty or dot-only names.
  const safeMessageId = basename(providerMessageId);
  if (!safeMessageId || safeMessageId === "." || safeMessageId === "..") {
    throw new Error(`Invalid provider message ID: ${providerMessageId}`);
  }

  const baseDir = resolve(attachmentsDir());
  const dir = resolve(join(baseDir, safeMessageId));

  // Verify the resolved directory is inside the base attachments directory.
  const messageDirRelativePath = relative(baseDir, dir);
  if (
    messageDirRelativePath.startsWith("..") ||
    messageDirRelativePath === "" ||
    messageDirRelativePath === "."
  ) {
    throw new Error(`Provider message ID path traversal detected: ${providerMessageId}`);
  }

  await mkdir(dir, { recursive: true });

  // Sanitize filename: extract basename, reject empty or dot-only names.
  const safe = basename(filename);
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Invalid attachment filename: ${filename}`);
  }

  const storagePath = resolve(join(dir, safe));

  // Verify the resolved path is still inside the message directory (defense in depth).
  const fileRelativePath = relative(dir, storagePath);
  if (fileRelativePath.startsWith("..") || fileRelativePath === "." || fileRelativePath === "") {
    throw new Error(`Attachment path traversal detected: ${filename}`);
  }

  await writeFile(storagePath, content);
  return storagePath;
}
