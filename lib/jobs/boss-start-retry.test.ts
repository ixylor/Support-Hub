import { afterEach, describe, expect, it, vi } from "vitest";

// A failed pg-boss start (e.g. Postgres not accepting connections yet at
// boot) must not poison every later getBoss() call with the same cached
// rejection. This mocks the pg-boss package itself so the first start() can
// be made to fail deterministically, without needing a real broken
// connection.
const startMock = vi.fn();
const createQueueMock = vi.fn();
const onMock = vi.fn();

vi.mock("pg-boss", () => ({
  PgBoss: vi.fn().mockImplementation(function PgBossMock(this: unknown) {
    return {
      start: startMock,
      createQueue: createQueueMock,
      on: onMock,
    };
  }),
}));

describe("getBoss after a failed start", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("retries on the next call instead of replaying the cached rejection", async () => {
    startMock.mockRejectedValueOnce(new Error("connection refused"));
    startMock.mockResolvedValueOnce(undefined);
    createQueueMock.mockResolvedValue(undefined);

    const { getBoss } = await import("./boss");

    await expect(getBoss()).rejects.toThrow("connection refused");

    // A second call after the failure must attempt a genuinely new start,
    // not resolve (or reject) with the first attempt's cached promise.
    const boss = await getBoss();

    expect(boss).toBeDefined();
    expect(startMock).toHaveBeenCalledTimes(2);
  });
});
