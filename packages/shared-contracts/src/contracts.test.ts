import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  chatCompletionsRequestSchema,
  downloadTaskSchema,
  gatewayDiscoveryFileSchema,
  gatewayEventSchema,
  gatewayHealthSnapshotSchema,
  modelArtifactSchema,
  modelProfileSchema,
  runtimeKeySchema,
  workerStateSchema,
} from "./index.js";

function loadFixture(fileName: string): unknown {
  return JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../fixtures", fileName), "utf8"),
  ) as unknown;
}

describe("shared contracts", () => {
  it("parses the stage 2 model artifact fixture", () => {
    const artifact = modelArtifactSchema.parse(
      loadFixture("foundation-model-artifact.sample.json"),
    );

    expect(artifact.id).toBe("model_qwen25_coder");
    expect(artifact.metadata.contextLength).toBe(32768);
  });

  it("parses the stage 2 model profile fixture", () => {
    const profile = modelProfileSchema.parse(loadFixture("foundation-model-profile.sample.json"));

    expect(profile.modelId).toBe("model_qwen25_coder");
    expect(profile.engineType).toBe("llama.cpp");
  });

  it("parses the stage 2 runtime fixtures", () => {
    const runtimeKey = runtimeKeySchema.parse(loadFixture("foundation-runtime-key.sample.json"));
    const workerState = workerStateSchema.parse(loadFixture("foundation-worker-state.sample.json"));

    expect(runtimeKey.engineType).toBe("llama.cpp");
    expect(workerState.runtimeKeyString).toContain("llama.cpp");
  });

  it("parses the stage 2 download task fixture", () => {
    const task = downloadTaskSchema.parse(loadFixture("foundation-download-task.sample.json"));

    expect(task.status).toBe("downloading");
    expect(task.metadata.fileName).toBe("model.gguf");
  });

  it("parses the stage 2 gateway event fixture", () => {
    const event = gatewayEventSchema.parse(loadFixture("foundation-gateway-event.sample.json"));

    expect(event.type).toBe("MODEL_STATE_CHANGED");
    expect(event.payload.runtimeKey.engineType).toBe("llama.cpp");
  });

  it("parses a gateway event envelope", () => {
    const runtimeKey = runtimeKeySchema.parse({
      modelId: "qwen2.5-coder",
      engineType: "llama.cpp",
      role: "chat",
      configHash: "cfg_1234",
    });

    const event = gatewayEventSchema.parse({
      type: "MODEL_STATE_CHANGED",
      ts: "2026-03-31T12:00:00.000Z",
      traceId: "trace_12345678",
      payload: {
        modelId: "qwen2.5-coder",
        runtimeKey,
        nextState: "Ready",
      },
    });

    expect(event.payload.nextState).toBe("Ready");
  });

  it("validates the discovery file contract", () => {
    const discovery = gatewayDiscoveryFileSchema.parse({
      environment: "development",
      gatewayVersion: "0.1.0",
      generatedAt: "2026-03-31T12:00:00.000Z",
      publicBaseUrl: "http://127.0.0.1:1337",
      controlBaseUrl: "http://127.0.0.1:16384",
      websocketUrl: "ws://127.0.0.1:16384/ws",
      supportRoot: "/tmp/local-llm-hub/dev",
    });

    expect(discovery.publicBaseUrl).toContain("1337");
  });

  it("accepts the v1 chat completion request skeleton", () => {
    const request = chatCompletionsRequestSchema.parse({
      model: "qwen2.5-coder",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      extra_body: {
        localhub: {
          prompt_cache_key: "cache_123",
        },
      },
    });

    expect(request.stream).toBe(true);
  });

  it("keeps health snapshots URL-safe", () => {
    const snapshot = gatewayHealthSnapshotSchema.parse({
      state: "ready",
      publicBaseUrl: "http://127.0.0.1:1337",
      controlBaseUrl: "http://127.0.0.1:16384",
      uptimeMs: 100,
      activeWorkers: 0,
      queuedRequests: 0,
      generatedAt: "2026-03-31T12:00:00.000Z",
    });

    expect(snapshot.state).toBe("ready");
  });
});
