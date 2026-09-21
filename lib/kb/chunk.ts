// Roughly 250 tokens of English per chunk, small enough that a retrieved chunk
// is specific and large enough to carry its own context. Tuning these is the
// most likely future change, which is why this file is a pure function.
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

// Prefer to break where a human would: between paragraphs, then between
// sentences, then between words. A hard character cut is the last resort.
function findBreakpoint(text: string, limit: number): number {
  const window = text.slice(0, limit);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph > limit * 0.5) return paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("! "),
    window.lastIndexOf("? ")
  );
  if (sentence > limit * 0.5) return sentence + 2;

  const space = window.lastIndexOf(" ");
  if (space > limit * 0.5) return space + 1;

  return limit;
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized === "") return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const remaining = normalized.slice(cursor);

    if (remaining.length <= CHUNK_SIZE) {
      const tail = remaining.trim();
      if (tail !== "") chunks.push(tail);
      break;
    }

    const breakpoint = findBreakpoint(remaining, CHUNK_SIZE);
    const chunk = remaining.slice(0, breakpoint).trim();
    if (chunk !== "") chunks.push(chunk);

    // Advance by at least one character beyond the overlap so a breakpoint
    // smaller than the overlap can't stall the loop.
    const advance = Math.max(breakpoint - CHUNK_OVERLAP, 1);
    cursor += advance;
  }

  return chunks;
}
