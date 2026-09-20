"use client";

import { useEffect, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { TicketAssignee } from "@/lib/tickets/queries";

const UNASSIGNED_VALUE = "__unassigned__";
const SEARCH_DEBOUNCE_MS = 200;

// The list is a page of server-side matches, never the whole directory, so
// cmdk must not also filter what came back.
async function fetchAssignees(query: string, signal: AbortSignal): Promise<TicketAssignee[]> {
  const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) {
    throw new Error("Search failed.");
  }
  const body = (await response.json()) as { users: TicketAssignee[] };
  return body.users;
}

export function AssigneeCombobox({
  value,
  onChange,
  currentUserId,
  trigger,
  align = "start",
  contentClassName = "w-64 p-0",
}: {
  value: TicketAssignee | null;
  onChange: (assignee: TicketAssignee | null) => void;
  currentUserId: string;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketAssignee[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Survives the popover closing, so reopening doesn't flash an empty list
  // before the first page comes back.
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    // Skip the debounce on first open: there is nothing to wait for yet.
    const delay = loadedOnce.current && query !== "" ? SEARCH_DEBOUNCE_MS : 0;

    // The state updates live inside the timer callback rather than the
    // effect body: setting them synchronously here would cascade a render
    // on every keystroke before the request is even sent.
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      fetchAssignees(query, controller.signal)
        .then((users) => {
          setResults(users);
          loadedOnce.current = true;
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== "AbortError") {
            setFailed(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, delay);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query]);

  function choose(assignee: TicketAssignee | null) {
    setOpen(false);
    setQuery("");
    onChange(assignee);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent className={contentClassName} align={align}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people..." value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Searching...
              </div>
            ) : failed ? (
              <div className="px-3 py-4 text-sm text-destructive">
                Could not load people. Try again.
              </div>
            ) : (
              <CommandEmpty>No one found.</CommandEmpty>
            )}
            <CommandGroup>
              {query === "" ? (
                <CommandItem
                  value={UNASSIGNED_VALUE}
                  data-checked={value === null}
                  onSelect={() => choose(null)}
                >
                  <span className="text-muted-foreground">Unassigned</span>
                </CommandItem>
              ) : null}
              {results.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={candidate.id}
                  data-checked={candidate.id === value?.id}
                  onSelect={() => choose(candidate)}
                >
                  <span className="truncate">{candidate.name}</span>
                  {candidate.id === currentUserId ? (
                    <span className="text-xs text-muted-foreground">you</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
