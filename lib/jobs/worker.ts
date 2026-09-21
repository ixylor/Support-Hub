import "dotenv/config";
import { getBoss, stopBoss } from "./boss";
import { registerHandlers } from "./handlers";

async function main(): Promise<void> {
  const boss = await getBoss();
  await registerHandlers(boss);

  console.log("Worker started.");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      // Graceful stop lets in-flight jobs finish rather than returning them to
      // the queue for a needless retry.
      void stopBoss().then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
