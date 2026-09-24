import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { activateDeployment, deactivateDeployment, type DeploymentRole } from "@/lib/ai/config";

const ROLES: DeploymentRole[] = ["chat", "embedding"];

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") return null;
  return session;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Only admins can change AI settings." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
    deploymentName?: unknown;
    modelName?: unknown;
    dimensions?: unknown;
  } | null;

  if (
    !body ||
    typeof body.role !== "string" ||
    !ROLES.includes(body.role as DeploymentRole) ||
    typeof body.deploymentName !== "string" ||
    body.deploymentName.trim() === "" ||
    typeof body.modelName !== "string" ||
    body.modelName.trim() === ""
  ) {
    return NextResponse.json(
      { error: `role must be one of ${ROLES.join(", ")}, with a deployment and model name.` },
      { status: 400 }
    );
  }

  try {
    await activateDeployment(
      {
        role: body.role as DeploymentRole,
        deploymentName: body.deploymentName.trim(),
        modelName: body.modelName.trim(),
        dimensions: typeof body.dimensions === "number" ? body.dimensions : null,
      },
      session.user.id
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can change AI settings." }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  await deactivateDeployment(id);
  return NextResponse.json({ ok: true });
}
