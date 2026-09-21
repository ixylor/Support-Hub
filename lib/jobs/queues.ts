// Queue names and their payload shapes live together so an enqueue with the
// wrong body is a compile error rather than a job that fails at 3am.
export const QUEUES = {
  kbProcess: "kb.process",
  mailboxPoll: "mailbox.poll",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  "kb.process": { entryId: string };
  "mailbox.poll": Record<string, never>;
}

export const RETRY_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
} as const;
