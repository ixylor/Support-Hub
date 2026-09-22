import type { JobWithMetadata, PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { pollMailboxOnce } from "@/lib/ingestion/poll-mailbox";
import { markKbEntryFailed, processKbEntry } from "@/lib/kb/process-entry";
import { resumeWorkflowRun, startWorkflowRun } from "@/lib/workflow/run";
import { QUEUES, type JobPayloads } from "./queues";

// Exported so retry-exhaustion can be exercised directly against real
// pg-boss job metadata (fetched from the real test queue) without waiting
// out the queue's real-time backoff delays between attempts.
export async function handleKbProcessJob(
  job: JobWithMetadata<{ entryId: string }>
): Promise<void> {
  try {
    await processKbEntry(job.data.entryId);
  } catch (error) {
    // processKbEntry only rethrows RetryableAiError; everything else it
    // already recorded on the entry itself. pg-boss increments retryCount on
    // each re-fetch of a job, so retryCount === retryLimit here means this
    // was the last attempt pg-boss will make — no more retries follow, so
    // this is the only place left to record the failure.
    if (job.retryCount >= job.retryLimit) {
      const message = error instanceof Error ? error.message : "Processing failed.";
      await markKbEntryFailed(job.data.entryId, message);
    }
    throw error;
  }
}

export async function handleWorkflowRunJob(
  job: JobWithMetadata<JobPayloads["workflow.run"]>
): Promise<void> {
  try {
    await startWorkflowRun(job.data.ticketId);
  } catch (error) {
    if (job.retryCount >= job.retryLimit) {
      const message = error instanceof Error ? error.message : "The workflow run failed.";
      await db
        .update(tickets)
        .set({ status: "escalated" })
        .where(eq(tickets.id, job.data.ticketId));
      console.error(
        `Workflow run for ticket ${job.data.ticketId} failed permanently: ${message}`
      );
    }
    throw error;
  }
}

export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.mailboxPoll, { batchSize: 1 }, async () => {
    const result = await pollMailboxOnce();
    console.log(`Mailbox poll ingested ${result.ingested} message(s).`, result.reason ?? "");
  });

  // The explicit third type argument pins pg-boss's `const O extends
  // WorkOptions` inference to a literal `includeMetadata: true`, which is
  // what selects the JobWithMetadata-typed handler overload below — passing
  // only the options object (even with `includeMetadata: true` written out)
  // is not enough for it to infer that literal on its own.
  await boss.work<{ entryId: string }, unknown, { batchSize: 1; includeMetadata: true }>(
    QUEUES.kbProcess,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      await handleKbProcessJob(job);
    }
  );

  await boss.work<
    JobPayloads["workflow.run"],
    unknown,
    { batchSize: 1; includeMetadata: true }
  >(
    QUEUES.workflowRun,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      await handleWorkflowRunJob(job);
    }
  );

  await boss.work<JobPayloads["workflow.resume"]>(
    QUEUES.workflowResume,
    { batchSize: 1 },
    async ([job]) => {
      await resumeWorkflowRun(job.data.approvalId);
    }
  );
}
