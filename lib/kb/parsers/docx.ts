import mammoth from "mammoth";
import type { DocumentParser } from "./parser";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const docxParser: DocumentParser = {
  supports(contentType) {
    return contentType === DOCX_TYPE;
  },

  async extract(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  },
};
