import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getSecret } from "@/lib/secrets/store";

const queryClient = postgres(process.env.DATABASE_URL!);
const authDb = drizzle(queryClient, { schema });

// A corrupt stored secret or a rotated APP_ENCRYPTION_KEY throws out of
// decryptSecret. This module is imported by the auth route handler, proxy.ts,
// and the dashboard layout, so an unguarded throw here would take down the
// entire app at boot — including email/password login, which doesn't need
// Google credentials at all. Fall back to "" and let Google sign-in alone
// be broken until the credential is fixed.
async function getSecretOrWarn(key: string): Promise<string> {
  try {
    return (await getSecret(key)) ?? "";
  } catch (error) {
    console.warn(
      `Failed to decrypt stored secret "${key}" — Google sign-in will not work until this is fixed.`,
      error
    );
    return "";
  }
}

const googleClientId = await getSecretOrWarn("google_client_id");
const googleClientSecret = await getSecretOrWarn("google_client_secret");

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
