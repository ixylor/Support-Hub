import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "@/lib/auth/schema";

const queryClient = postgres(process.env.DATABASE_URL!);

export const db = drizzle(queryClient, { schema: { ...schema, ...authSchema } });
