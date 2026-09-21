import type { PgBoss } from "pg-boss";
import { pollMailboxOnce } from "@/lib/ingestion/poll-mailbox";
import { processKbEntry } from "@/lib/kb/process-entry";
import { QUEUES } from "./queues";

export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.mailboxPoll, { batchSize: 1 }, async () => {
    const result = await pollMailboxOnce();
    console.log(`Mailbox poll ingested ${result.ingested} message(s).`, result.reason ?? "");
  });

  await boss.work(QUEUES.kbProcess, { batchSize: 1 }, async ([job]) => {
    await processKbEntry(job.data.entryId);
  });
}
