const LIST_ITEM = /^(?:[-*•]\s+|\d+[.)]\s+)/;

/** Join model-generated soft wraps while preserving paragraphs and lists. */
export function normalizeEmailBody(body: string): string {
  const paragraphs: string[] = [];
  let prose: string[] = [];
  let list: string[] = [];

  const flushProse = () => {
    if (prose.length > 0) paragraphs.push(prose.join(" "));
    prose = [];
  };
  const flushList = () => {
    if (list.length > 0) paragraphs.push(list.join("\n"));
    list = [];
  };

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/[\t ]+/g, " ").trim();
    if (!line) {
      flushProse();
      flushList();
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushProse();
      list.push(line);
    } else if (list.length > 0) {
      // A wrapped list item continues the previous bullet instead of
      // becoming a new paragraph.
      list[list.length - 1] += ` ${line}`;
    } else {
      prose.push(line);
    }
  }

  flushProse();
  flushList();
  return paragraphs.join("\n\n").trim();
}
