import type { LogLevel } from "@localhub/shared-contracts/foundation-common";

const ERROR_PATTERNS = [
  /\b(error|errors|failed|failure|fatal|exception|panic|crash|abort|traceback)\b/i,
  /\b(assertion failed|segmentation fault|unhandled rejection|unhandled exception)\b/i,
];

const WARN_PATTERNS = [
  /\b(warn|warning|deprecated|deprecation|fallback|retry|retrying|timed out|timeout)\b/i,
  /\b(could not|unable to|unsupported|skipping|ignored|missing|not found|refused|denied)\b/i,
];

const INFO_PATTERNS = [
  /\b(boot|starting|started|ready|warming|warmed|shutting down|shutdown|cleaning up|cleanup)\b/i,
  /\b(deallocating|deallocated|freeing|memory breakdown|breakdown|draining|stopping|stopped|closing|closed|teardown|tearing down)\b/i,
];

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyStderrLogLevel(message: string): LogLevel {
  const normalized = message.trim();

  if (!normalized) {
    return "info";
  }

  if (matchesAny(ERROR_PATTERNS, normalized)) {
    return "error";
  }

  if (matchesAny(WARN_PATTERNS, normalized)) {
    return "warn";
  }

  if (matchesAny(INFO_PATTERNS, normalized)) {
    return "info";
  }

  return "info";
}
