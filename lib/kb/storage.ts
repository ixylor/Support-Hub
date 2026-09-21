import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export function kbStorageDir(): string {
  return process.env.KB_STORAGE_DIR ?? "./storage/kb";
}

function safeSegment(value: string, label: string): string {
  const segment = basename(value);
  // basename() silently strips any leading path components, so a traversal
  // attempt like "../escape.pdf" would otherwise pass through unnoticed.
  // Comparing against the original value catches that instead of masking it.
  if (!segment || segment === "." || segment === ".." || segment !== value) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return segment;
}

export async function saveKbFile(
  entryId: string,
  filename: string,
  content: Buffer
): Promise<string> {
  const baseDir = resolve(kbStorageDir());
  const dir = resolve(join(baseDir, safeSegment(entryId, "entry id")));

  const dirRelative = relative(baseDir, dir);
  if (dirRelative.startsWith("..") || dirRelative === "" || dirRelative === ".") {
    throw new Error(`Entry id path traversal detected: ${entryId}`);
  }

  await mkdir(dir, { recursive: true });

  const storagePath = resolve(join(dir, safeSegment(filename, "filename")));
  const fileRelative = relative(dir, storagePath);
  if (fileRelative.startsWith("..") || fileRelative === "" || fileRelative === ".") {
    throw new Error(`Filename path traversal detected: ${filename}`);
  }

  await writeFile(storagePath, content);
  return storagePath;
}

// Re-validates the stored path against the configured root rather than trusting
// what the database holds, matching the attachment-serving route's approach.
export async function readKbFile(storagePath: string): Promise<Buffer> {
  const baseDir = resolve(kbStorageDir());
  const resolved = resolve(storagePath);
  const relativePath = relative(baseDir, resolved);

  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Refusing to read a path outside the knowledge base directory: ${storagePath}`);
  }

  return readFile(resolved);
}
