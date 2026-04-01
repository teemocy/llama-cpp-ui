import type { GatewayEvent } from "./events.js";
import { gatewayEventSchema } from "./events.js";
import type { OpenAiToolCall } from "./openai.js";
import { openAiToolCallSchema } from "./openai.js";
import type { RequestTrace } from "./request-tracing.js";
import { requestTraceSchema } from "./request-tracing.js";

const openAiToolCallArraySchema = openAiToolCallSchema.array();

export function serializeToolCalls(toolCalls: OpenAiToolCall[]): string {
  return JSON.stringify(openAiToolCallArraySchema.parse(toolCalls));
}

export function deserializeToolCalls(value: string): OpenAiToolCall[] {
  return openAiToolCallArraySchema.parse(JSON.parse(value));
}

export function serializeGatewayEvent(event: GatewayEvent): string {
  return JSON.stringify(gatewayEventSchema.parse(event));
}

export function deserializeGatewayEvent(value: string): GatewayEvent {
  return gatewayEventSchema.parse(JSON.parse(value));
}

export function serializeRequestTrace(trace: RequestTrace): string {
  return JSON.stringify(requestTraceSchema.parse(trace));
}

export function deserializeRequestTrace(value: string): RequestTrace {
  return requestTraceSchema.parse(JSON.parse(value));
}
