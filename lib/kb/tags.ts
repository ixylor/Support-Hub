// Tags are compared by equality in retrieval filters, so every entry point —
// writing an entry and filtering a search — normalizes through this one
// function rather than each re-implementing the rule.
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== "");
  return [...new Set(normalized)].sort();
}
