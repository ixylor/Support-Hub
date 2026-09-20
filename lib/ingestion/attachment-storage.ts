import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Read lazily (not as a module-level const) so tests can stub the env var
// per-test via vi.stubEnv + vi.resetModules.
function attachmentsDir(): string {
  return process.env.ATTACHMENTS_DIR ?? "./storage/attachments";
}

export async function saveAttachment(
  ticketMessageId: string,
  filename: string,
  content: Buffer
): Promise<string> {
  const dir = join(attachmentsDir(), ticketMessageId);
  await mkdir(dir, { recursive: true });
  const storagePath = join(dir, filename);
  await writeFile(storagePath, content);
  return storagePath;
}
