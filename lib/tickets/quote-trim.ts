// Heuristically separates the "new" part of an email reply body from the
// quoted history (and trailing signature) that most mail clients append.
// This is display-only: it never touches what is stored in the database,
// and it is inherently a best-effort guess — real-world emails are messy
// and no fixed set of patterns will catch every mail client's format.

export type QuoteSplitResult = {
  /** The part of the body worth showing by default. */
  visible: string;
  /** The trailing quoted/boilerplate part, or null if none was detected. */
  quoted: string | null;
};

// One or more ">" quote markers at the start of a line (allowing a little
// leading whitespace, and any number of nested "> > >" levels).
const QUOTE_PREFIX = /^\s{0,3}>/;

// Gmail/Apple Mail/most webmail style: "On <date>, <name> wrote:"
const ATTRIBUTION_LINE = /^On\s.+\swrote:\s*$/i;

// Outlook's classic separator above a forwarded/replied-to message.
const ORIGINAL_MESSAGE_SEPARATOR = /^-{3,}\s*Original Message\s*-{3,}$/i;

// RFC 3676 signature delimiter: a line that is exactly "-- " (or "--").
const SIGNATURE_DELIMITER = /^--\s?$/;

const HEADER_FROM = /^From:\s*.+/i;
const HEADER_SENT_OR_DATE = /^(Sent|Date):\s*.+/i;
const HEADER_TO = /^To:\s*.+/i;
const HEADER_SUBJECT = /^Subject:\s*.+/i;

// Outlook/Exchange plain-text replies often paste a raw header block
// ("From:" / "Sent:" / "To:" / "Subject:") above the quoted message instead
// of (or in addition to) the "-----Original Message-----" separator. Treat
// a "From:" line as the start of that block if at least two of the other
// three headers show up shortly after it.
function isHeaderBlockStart(lines: string[], index: number): boolean {
  if (!HEADER_FROM.test(lines[index].trim())) {
    return false;
  }

  const window = lines.slice(index + 1, index + 5).map((line) => line.trim());
  const matches = [HEADER_SENT_OR_DATE, HEADER_TO, HEADER_SUBJECT].filter((pattern) =>
    window.some((line) => pattern.test(line))
  );
  return matches.length >= 2;
}

function isCutLine(lines: string[], index: number): boolean {
  const raw = lines[index];
  const trimmed = raw.trim();
  return (
    QUOTE_PREFIX.test(raw) ||
    ATTRIBUTION_LINE.test(trimmed) ||
    ORIGINAL_MESSAGE_SEPARATOR.test(trimmed) ||
    SIGNATURE_DELIMITER.test(trimmed) ||
    isHeaderBlockStart(lines, index)
  );
}

/**
 * Splits a raw message body into the text worth showing and the quoted
 * history/signature worth collapsing behind an affordance.
 *
 * Returns `{ visible: body, quoted: null }` whenever no quoting is detected,
 * or whenever the detected "new" portion is empty/whitespace-only — a
 * message that is entirely quoted (a bare forward) is shown in full rather
 * than collapsed to a blank card.
 */
export function splitQuotedContent(body: string): QuoteSplitResult {
  const lines = body.split(/\r\n|\r|\n/);

  let cutIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isCutLine(lines, i)) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex === -1) {
    return { visible: body, quoted: null };
  }

  const visibleLines = lines.slice(0, cutIndex);
  const quotedLines = lines.slice(cutIndex);

  if (visibleLines.every((line) => line.trim() === "")) {
    // Nothing but the quoted/boilerplate portion — showing that beats
    // showing an empty card.
    return { visible: body, quoted: null };
  }

  return {
    visible: visibleLines.join("\n").trimEnd(),
    quoted: quotedLines.join("\n"),
  };
}
