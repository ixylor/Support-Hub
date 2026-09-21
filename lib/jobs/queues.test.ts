import { afterAll, describe, expect, it } from "vitest";
import { QUEUES, enqueue, getBoss, stopBoss } from "./boss";

describe("job queue", () => {
  afterAll(async () => {
    await stopBoss();
  });

  it("creates every declared queue on start", async () => {
    const boss = await getBoss();

    for (const name of Object.values(QUEUES)) {
      expect(await boss.getQueue(name)).not.toBeNull();
    }
  });

  it("returns the same instance on repeated calls", async () => {
    expect(await getBoss()).toBe(await getBoss());
  });

  it("enqueues a job that the queue then holds", async () => {
    const boss = await getBoss();
    const entryId = crypto.randomUUID();

    await enqueue(QUEUES.kbProcess, { entryId });

    const [job] = await boss.fetch(QUEUES.kbProcess, { batchSize: 1 });
    expect(job?.data).toEqual({ entryId });
    await boss.complete(QUEUES.kbProcess, job!.id);
  });
});
