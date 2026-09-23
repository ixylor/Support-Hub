import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { defaultRoles } from "better-auth/plugins/admin/access";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const queryClient = postgres(process.env.DATABASE_URL!);
const authDb = drizzle(queryClient, { schema });
const canonicalBaseURL = process.env.BETTER_AUTH_URL;
const allowedAuthHosts = [
  canonicalBaseURL ? new URL(canonicalBaseURL).host : undefined,
  "support.imeld.ai",
  process.env.VERCEL_URL,
  process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
].filter((host): host is string => Boolean(host));

// Google is the platform's own login provider — a bootstrap dependency like
// DATABASE_URL or BETTER_AUTH_SECRET, so it lives in .env rather than the
// encrypted app_secrets store (which is reserved for admin-managed business
// integrations, e.g. the Microsoft Graph mailbox connection).
export const auth = betterAuth({
  baseURL: {
    allowedHosts: [...new Set(allowedAuthHosts)],
    fallback: canonicalBaseURL,
    protocol: process.env.NODE_ENV === "development" ? "http" : "https",
  },
  database: drizzleAdapter(authDb, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
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
  plugins: [
    admin({
      defaultRole: "agent",
      adminRoles: ["admin"],
      roles: {
        admin: defaultRoles.admin,
        agent: defaultRoles.user,
      },
    }),
  ],
});
