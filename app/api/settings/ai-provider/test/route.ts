import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getActiveDeployment, getAzureCredentials, type DeploymentRole } from "@/lib/ai/config";
import { embedTexts } from "@/lib/ai/embeddings";
import { pdfParser } from "@/lib/kb/parsers/pdf";

// One real call per role. A wrong deployment name then surfaces here rather
// than as a pile of failed jobs an hour later.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can test AI settings." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  const role = body?.role as DeploymentRole | undefined;

  if (role !== "chat" && role !== "embedding" && role !== "extraction") {
    return NextResponse.json({ error: "role must be chat, embedding or extraction." }, { status: 400 });
  }

  const credentials = await getAzureCredentials();
  const deployment = await getActiveDeployment(role);

  if (!credentials) {
    return NextResponse.json({ ok: false, error: "Credentials are not configured." });
  }
  if (!deployment) {
    return NextResponse.json({ ok: false, error: `No active ${role} deployment.` });
  }

  try {
    if (role === "embedding") {
      await embedTexts(["connection test"]);
    } else if (role === "extraction") {
      const fixture = join(process.cwd(), "lib/kb/parsers/fixtures/sample.pdf");
      await pdfParser.extract(await readFile(fixture));
    } else {
      const response = await fetch(
        `${credentials.endpoint}/openai/deployments/${deployment.deploymentName}/chat/completions?api-version=${credentials.apiVersion}`,
        {
          method: "POST",
          headers: { "api-key": credentials.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
        }
      );
      if (!response.ok) {
        throw new Error(`Chat deployment returned ${response.status}.`);
      }
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message });
  }

  return NextResponse.json({ ok: true });
}
