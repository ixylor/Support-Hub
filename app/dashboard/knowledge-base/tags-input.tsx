"use client";

import { useId, useState } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

// A free-solo multi-select: known tags are offered as suggestions, but
// anything typed and confirmed becomes a tag, matching how entries are
// actually tagged (lib/kb/entries normalizes and dedupes on the server).
export function TagsInput({
  value,
  onChange,
  knownTags,
  label = "Tags",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  knownTags: string[];
  label?: string;
}) {
  const inputId = useId();
  const anchorRef = useComboboxAnchor();
  const [query, setQuery] = useState("");
  const trimmedQuery = normalize(query);

  const suggestions = knownTags.filter(
    (tag) => !value.includes(tag) && tag.includes(trimmedQuery)
  );

  // The typed tag leads the list so it is the auto-highlighted Enter target,
  // unless it is already offered as a suggestion or already selected.
  const creatable =
    trimmedQuery !== "" && !suggestions.includes(trimmedQuery) && !value.includes(trimmedQuery)
      ? trimmedQuery
      : null;
  const items = creatable === null ? suggestions : [creatable, ...suggestions];

  function addTag(raw: string) {
    const tag = normalize(raw);
    setQuery("");
    if (tag === "" || value.includes(tag)) return;
    onChange([...value, tag]);
  }

  return (
    <Combobox
      items={items}
      filter={null}
      autoHighlight
      multiple
      value={value}
      onValueChange={onChange}
      inputValue={query}
      // Only typing keeps the query; picking a tag, clearing, or closing the
      // list resets it so the next tag starts from an empty field.
      onInputValueChange={(next, details) => {
        setQuery(details.reason === "input-change" ? next : "");
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </label>
        <ComboboxValue>
          {(selected: string[]) => (
            <ComboboxChips
              ref={anchorRef}
              aria-label={selected.length > 0 ? `Selected ${label.toLowerCase()}` : undefined}
            >
              {selected.map((tag) => (
                <ComboboxChip
                  key={tag}
                  aria-label={tag}
                  aria-description="Press Backspace or Delete to remove"
                >
                  {tag}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={inputId}
                placeholder={selected.length > 0 ? "" : "Add tag..."}
                onKeyDown={(event) => {
                  if (event.key !== ",") return;
                  event.preventDefault();
                  addTag(query);
                }}
              />
            </ComboboxChips>
          )}
        </ComboboxValue>
      </div>
      <ComboboxContent anchor={anchorRef}>
        <ComboboxEmpty>Type to add a tag.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item === creatable ? `Create "${item}"` : item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
