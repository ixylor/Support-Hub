import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getSecret } from "@/lib/secrets/store";

const queryClient = postgres(process.env.DATABASE_URL!);
const authDb = drizzle(queryClient, { schema });

const googleClientId = (await getSecret("google_client_id")) ?? "";
const googleClientSecret = (await getSecret("google_client_secret")) ?? "";

export const auth = betterAuth({
  database: drizzleAdapter(authDb, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "agent",
        input: false,
      },
    },
  },
});
