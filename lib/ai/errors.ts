// Thrown when the provider has not been set up at all. Callers surface this to
// the admin as "configure the AI provider" rather than retrying it.
export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

// A transient upstream condition — network failure, 429, 5xx. The job handler
// rethrows these so pg-boss's backoff applies.
export class RetryableAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableAiError";
  }
}

// The request will fail the same way every time: a rejected file, a bad
// deployment name, a malformed response. Retrying three times wastes money.
export class PermanentAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentAiError";
  }
}
