import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let saver: PostgresSaver | null = null;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  return url;
}

export async function getCheckpointer(): Promise<PostgresSaver> {
  // One saver per process: it owns a connection pool, and a new one per run
  // would exhaust Postgres connections under load.
  saver ??= PostgresSaver.fromConnString(connectionString());
  return saver;
}

// Run explicitly as a migration step rather than lazily at worker boot, so a
// fresh deploy is deterministic and CI matches production.
export async function setupCheckpointer(): Promise<void> {
  const checkpointer = await getCheckpointer();
  await checkpointer.setup();
}
