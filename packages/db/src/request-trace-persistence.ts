import type { ApiLogRecord } from "@localhub/shared-contracts/foundation-persistence";
import {
  type RequestTrace,
  requestTraceSchema,
  requestTraceToApiEndpoint,
} from "@localhub/shared-contracts/foundation-request-tracing";

export function requestTraceToApiLogRecord(trace: RequestTrace): ApiLogRecord {
  const parsed = requestTraceSchema.parse(trace);
  const promptTokens = parsed.promptTokens;
  const completionTokens = parsed.completionTokens;
  const durationMs = parsed.durationMs;
  const totalTokens =
    promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined;
  const tokensPerSecond =
    totalTokens !== undefined && durationMs !== undefined && durationMs > 0
      ? Number(((totalTokens * 1000) / durationMs).toFixed(2))
      : undefined;

  return {
    traceId: parsed.traceId,
    modelId: parsed.modelId,
    endpoint: requestTraceToApiEndpoint(parsed.route),
    requestIp: parsed.remoteAddress,
    promptTokens,
    completionTokens,
    ttftMs: parsed.ttftMs,
    totalDurationMs: durationMs,
    tokensPerSecond,
    statusCode: parsed.statusCode,
    createdAt: parsed.completedAt ?? parsed.receivedAt,
  };
}
