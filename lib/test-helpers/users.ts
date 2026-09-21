import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

// Tests need a real user row because most tables reference user.id. The id is
// random per call so parallel-ish tests in one file never collide.
export async function createTestUser(role: "admin" | "agent" = "admin"): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: `Test ${role}`,
    email: `${id}@example.test`,
    emailVerified: true,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}
