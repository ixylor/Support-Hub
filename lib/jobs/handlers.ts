import type { PgBoss } from "pg-boss";

// Every queue's worker is registered here, so the worker entrypoint stays a
// three-line file and adding a handler never touches process lifecycle code.
export async function registerHandlers(_boss: PgBoss): Promise<void> {
  // Handlers are added by later tasks.
}
