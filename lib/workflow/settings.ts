import { db } from "@/lib/db/client";
import { workflowSettings } from "@/lib/db/schema";

export interface WorkflowSettings {
  isEnabled: boolean;
  requireApproval: boolean;
  autoSendMinConfidence: number;
}

export async function getWorkflowSettings(): Promise<WorkflowSettings> {
  const [row] = await db.select().from(workflowSettings).limit(1);
  if (!row) {
    throw new Error("Workflow settings are missing — has the latest migration run?");
  }

  return {
    isEnabled: row.isEnabled,
    requireApproval: row.requireApproval,
    autoSendMinConfidence: Number(row.autoSendMinConfidence),
  };
}

export async function updateWorkflowSettings(
  input: WorkflowSettings,
  updatedByUserId: string
): Promise<void> {
  if (
    !Number.isFinite(input.autoSendMinConfidence) ||
    input.autoSendMinConfidence < 0 ||
    input.autoSendMinConfidence > 1
  ) {
    throw new Error(
      `The confidence floor must be between 0 and 1, got ${input.autoSendMinConfidence}.`
    );
  }

  // The table holds exactly one row, seeded by migration, so an unfiltered
  // update is the whole write.
  await db.update(workflowSettings).set({
    isEnabled: input.isEnabled,
    requireApproval: input.requireApproval,
    autoSendMinConfidence: String(input.autoSendMinConfidence),
    updatedByUserId,
  });
}
