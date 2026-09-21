import { PgBoss } from "pg-boss";
import { JobPayloads, QUEUES, QueueName, RETRY_OPTIONS } from "./queues";

export { QUEUES } from "./queues";
export type { JobPayloads, QueueName } from "./queues";

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

// pg-boss owns its own `pgboss` schema and runs its own migrations, so it
// never collides with drizzle-kit's.
async function start(): Promise<PgBoss> {
  const boss = new PgBoss(process.env.DATABASE_URL!);

  boss.on("error", (error) => {
    console.error("pg-boss error:", error);
  });

  await boss.start();

  // Queues must exist before anything is sent to them.
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }

  instance = boss;
  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  if (instance) return instance;
  // Guard against two concurrent callers both running the migration.
  starting ??= start().catch((error) => {
    // A failed start (e.g. Postgres not accepting connections yet) must not
    // poison every later call with the same cached rejection — clear it so
    // the next getBoss() genuinely retries.
    starting = null;
    throw error;
  });
  return starting;
}

export async function enqueue<K extends QueueName>(
  queue: K,
  payload: JobPayloads[K]
): Promise<void> {
  const boss = await getBoss();
  await boss.send(queue, payload, RETRY_OPTIONS);
}

export async function stopBoss(): Promise<void> {
  if (!instance) return;
  await instance.stop({ graceful: true });
  instance = null;
  starting = null;
}
