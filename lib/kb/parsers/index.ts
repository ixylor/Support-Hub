import { docxParser } from "./docx";
import { textParser } from "./text";
import type { DocumentParser, KbSourceType } from "./parser";

export type { DocumentParser, KbSourceType } from "./parser";

export const SUPPORTED_CONTENT_TYPES: Record<string, KbSourceType> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
};

const PARSERS: DocumentParser[] = [docxParser, textParser];

// Browsers send "text/plain; charset=utf-8"; the parameters are irrelevant to
// which parser applies.
export function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

export function getParser(contentType: string): DocumentParser | null {
  const normalized = normalizeContentType(contentType);
  return PARSERS.find((parser) => parser.supports(normalized)) ?? null;
}
