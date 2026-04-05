import { describe, expect, it } from "vitest";

import type { DesktopChatRunRequest } from "@localhub/shared-contracts";

import { MockGatewayRuntime } from "./mockRuntime.js";

const createMultimodalRequest = (model: string): DesktopChatRunRequest => ({
  model,
  message: [
    {
      type: "text",
      text: "Describe the image.",
    },
    {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,AAAA",
      },
    },
  ],
});

describe("mock gateway runtime", () => {
  it("summarizes multimodal prompts when generating chat completions", () => {
    const runtime = new MockGatewayRuntime({ telemetryIntervalMs: 60_000 });

    const response = runtime.runChat(createMultimodalRequest("localhub/qwen2.5-vl-7b-instruct-q4"));

    expect(Array.isArray(response.userMessage.content)).toBe(true);
    expect(response.assistantMessage.content).toContain("1 image");
  });

  it("rejects image prompts for text-only models", () => {
    const runtime = new MockGatewayRuntime({ telemetryIntervalMs: 60_000 });

    expect(() =>
      runtime.runChat(createMultimodalRequest("localhub/tinyllama-1.1b-chat-q4")),
    ).toThrow(/image inputs/);
  });
});
