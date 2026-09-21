"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RiCloseLine } from "@remixicon/react";
import { cn } from "cn";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  function normalize(raw: string): string {
    return raw.trim().toLowerCase();
  }

  function addTag(raw: string) {
    const tag = normalize(raw);
    if (tag === "" || value.includes(tag)) {
      setQuery("");
      return;
    }
    onChange([...value, tag]);
    setQuery("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((existing) => existing !== tag));
  }

  const suggestions = knownTags.filter(
    (tag) => !value.includes(tag) && tag.includes(normalize(query))
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 px-2 py-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => removeTag(tag)}
              className="opacity-60 hover:opacity-100"
            >
              <RiCloseLine className="size-3" />
            </button>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <InputGroup className={cn("w-48 border-b border-transparent border-b-input")}>
                <InputGroupInput
                  placeholder="Add tag..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag(query);
                    } else if (event.key === "Backspace" && query === "" && value.length > 0) {
                      removeTag(value[value.length - 1]);
                    }
                  }}
                />
              </InputGroup>
            }
          />
          <PopoverContent className="w-48 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandList>
                <CommandEmpty>
                  {query.trim() === "" ? "Type to add a tag." : `Press Enter to add "${query.trim()}".`}
                </CommandEmpty>
                <CommandGroup>
                  {suggestions.map((tag) => (
                    <CommandItem key={tag} value={tag} onSelect={() => addTag(tag)}>
                      {tag}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
