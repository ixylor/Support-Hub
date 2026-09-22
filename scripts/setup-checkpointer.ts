// Creates (or migrates) the checkpointer's own tables against DATABASE_URL.
// These tables are owned by @langchain/langgraph-checkpoint-postgres, not by
// drizzle — they're created through PostgresSaver.setup(), so this is not a
// drizzle migration and does not go through db:generate.
import "dotenv/config";
import { setupCheckpointer } from "../lib/workflow/checkpointer";

async function main() {
  await setupCheckpointer();
  console.log("Checkpointer tables are ready.");
}

main().catch((error) => {
  console.error("Failed to set up the checkpointer tables:", error);
  process.exit(1);
});
