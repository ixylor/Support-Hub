"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagsInput } from "./tags-input";

interface SearchResult {
  chunkId: string;
  entryId: string;
  title: string;
  tags: string[];
  chunkText: string;
  score: number;
}

export function SearchBox({ knownTags }: { knownTags: string[] }) {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/kb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, tags: tags.length ? tags : undefined }),
      });
      const payload = (await response.json()) as { results?: SearchResult[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Search failed.");
      }
      setResults(payload.results ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-search-query">Test retrieval query</Label>
            <Input
              id="kb-search-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="What would a customer ask?"
            />
          </div>
          <TagsInput value={tags} onChange={setTags} knownTags={knownTags} label="Filter by tags" />
          <div>
            <Button type="submit" disabled={searching || query.trim() === ""}>
              {searching ? "Searching..." : "Search"}
            </Button>
          </div>
        </form>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {results !== null && !error ? (
          results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching chunks.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {results.map((result, index) => (
                <li key={result.chunkId} className="border-b pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {index + 1}. {result.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      score {result.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {result.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{result.chunkText}</p>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
