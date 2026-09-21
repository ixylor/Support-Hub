import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kbEntries } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { RetryableAiError } from "@/lib/ai/errors";
import * as embeddings from "@/lib/ai/embeddings";
import { getBoss, stopBoss } from "./boss";
import { QUEUES, RETRY_OPTIONS } from "./queues";
import { handleKbProcessJob } from "./handlers";

// Exercises the kb.process handler together with a real pg-boss queue, which
// is the coverage gap that let a retryable failure get stuck at `processing`
// forever with no error recorded: process-entry.test.ts tests processKbEntry
// in isolation, and queues.test.ts tests the queue in isolation, but nothing
// drove the two together with the retry limit actually exhausted.
describe("kb.process handler against a real queue", () => {
  let adminId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(user)
      .values({
        id: `handlers-test-${crypto.randomUUID()}`,
        name: "Handlers Admin",
        email: `handlers-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = row.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(kbEntries);
  });

  afterAll(async () => {
    await stopBoss();
  });

  it("writes status = failed with the error text once pg-boss exhausts every retry", async () => {
    vi.spyOn(embeddings, "embedTexts").mockRejectedValue(
      new RetryableAiError("Azure is rate-limiting embedding requests.")
    );

    const [entry] = await db
      .insert(kbEntries)
      .values({
        title: "Flaky",
        sourceType: "article",
        content: "Refunds are issued within fourteen days.",
        uploadedByUserId: adminId,
      })
      .returning({ id: kbEntries.id });
    const entryId = entry.id;

    const boss = await getBoss();
    await boss.send(QUEUES.kbProcess, { entryId }, RETRY_OPTIONS);

    // Drive every attempt through pg-boss's real retry state machine — fetch()
    // increments retryCount exactly as the running worker would, and fail()
    // decides retry vs. terminal from the real retryLimit — but invoke the
    // handler directly rather than through boss.work(), so the test does not
    // have to wait out real-time backoff delays between attempts.
    for (let attempt = 0; attempt <= RETRY_OPTIONS.retryLimit; attempt++) {
      const [job] = await boss.fetch<{ entryId: string }>(QUEUES.kbProcess, {
        batchSize: 1,
        includeMetadata: true,
        ignoreStartAfter: true,
      });

      expect(job).toBeDefined();
      expect(job!.retryCount).toBe(attempt);
      expect(job!.retryLimit).toBe(RETRY_OPTIONS.retryLimit);

      await expect(handleKbProcessJob(job!)).rejects.toThrow(RetryableAiError);
      await boss.fail(QUEUES.kbProcess, job!.id);

      const [row] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId));
      if (attempt < RETRY_OPTIONS.retryLimit) {
        expect(row.status).toBe("processing");
        expect(row.errorMessage).toBeNull();
      } else {
        expect(row.status).toBe("failed");
        expect(row.errorMessage).toMatch(/rate-limiting/);
      }
    }

    // pg-boss agrees the job is terminally done — nothing left to fetch, no
    // further retry is scheduled.
    const remaining = await boss.fetch(QUEUES.kbProcess, {
      batchSize: 1,
      ignoreStartAfter: true,
    });
    expect(remaining).toEqual([]);
  });
});
