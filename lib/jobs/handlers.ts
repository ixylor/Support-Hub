import type { PgBoss } from "pg-boss";
import { pollMailboxOnce } from "@/lib/ingestion/poll-mailbox";
import { QUEUES } from "./queues";

export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.mailboxPoll, { batchSize: 1 }, async () => {
    const result = await pollMailboxOnce();
    console.log(`Mailbox poll ingested ${result.ingested} message(s).`, result.reason ?? "");
  });
}
