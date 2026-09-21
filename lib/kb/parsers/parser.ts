export type KbSourceType = "pdf" | "docx" | "text" | "markdown" | "article";

// One interface for every format, in the same spirit as MailProvider: the
// pipeline never learns which format it is handling.
export interface DocumentParser {
  supports(contentType: string): boolean;
  extract(buffer: Buffer): Promise<string>;
}
