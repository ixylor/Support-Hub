// Queue names and their payload shapes live together so an enqueue with the
// wrong body is a compile error rather than a job that fails at 3am.
export const QUEUES = {
  kbProcess: "kb.process",
  mailboxPoll: "mailbox.poll",
  workflowRun: "workflow.run",
  workflowResume: "workflow.resume",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  "kb.process": { entryId: string };
  "mailbox.poll": Record<string, never>;
  "workflow.run": { ticketId: string; trigger: "new_ticket" | "customer_reply" | "manual" };
  "workflow.resume": { approvalId: string };
}

export const RETRY_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
} as const;
