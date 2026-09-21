import type { DocumentParser } from "./parser";

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

export const textParser: DocumentParser = {
  supports(contentType) {
    return TEXT_TYPES.has(contentType);
  },

  async extract(buffer) {
    // A UTF-8 decode never throws on its own — it substitutes U+FFFD. Checking
    // for that is what catches a binary file mislabelled as text/plain, which
    // would otherwise be indexed as a page of replacement characters.
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (text.includes("�")) {
      throw new Error("File is not valid UTF-8 text.");
    }
    return text;
  },
};
