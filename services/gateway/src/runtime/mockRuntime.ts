import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  type ApiLogRecord,
  type ChatCompletionsRequest,
  type ChatCompletionsResponse,
  type ChatMessage,
  type ChatSession,
  type DesktopApiLogList,
  type DesktopChatMessageList,
  type DesktopChatRunRequest,
  type DesktopChatRunResponse,
  type DesktopChatSessionList,
  type DesktopChatSessionUpsertRequest,
  type DesktopDownloadActionResponse,
  type DesktopDownloadCreateRequest,
  type DesktopDownloadList,
  type DesktopLocalModelImportResponse,
  type DesktopModelRecord,
  type DesktopModelRuntimeState,
  type DesktopProviderSearchResult,
  type EmbeddingsRequest,
  type EmbeddingsResponse,
  type GatewayEvent,
  gatewayEventSchema,
} from "@localhub/shared-contracts";

import {
  type ChatCompletionsStreamResult,
  type ControlHealthSnapshot,
  type EngineRecord,
  type EvictModelResult,
  type GatewayExecutionContext,
  type GatewayPlane,
  GatewayRequestError,
  type PreloadModelResult,
  type RequestTraceRecord,
  type RuntimeEventKey,
  type RuntimeEventRole,
  type RuntimeEventRoute,
  type RuntimeEventTrace,
  type RuntimeLifecycleState,
  type RuntimeModelRecord,
  type WorkerState,
} from "../types.js";

type GatewaySubscriber = (event: GatewayEvent) => void;

interface MockGatewayRuntimeOptions {
  telemetryIntervalMs: number;
}

interface ModelStateEventOptions {
  previousState?: WorkerState | undefined;
  reason?: string | undefined;
  traceId?: string | undefined;
}

const DEFAULT_ENGINE_TYPE = "llama.cpp";
const DEFAULT_CONFIG_HASH = "stage1-mock";
const MOCK_RESIDENT_MEMORY_BYTES = 2_147_483_648;
const MOCK_GPU_MEMORY_BYTES = 1_073_741_824;

function toDesktopModelState(state: WorkerState): DesktopModelRuntimeState {
  switch (state) {
    case "Loading":
      return "loading";
    case "Ready":
    case "Busy":
      return "ready";
    case "Unloading":
    case "CoolingDown":
      return "evicting";
    case "Crashed":
      return "error";
    default:
      return "idle";
  }
}

function createModel(id: string, created: number, capabilities: string[]): RuntimeModelRecord {
  return {
    id,
    object: "model",
    created,
    owned_by: "localhub",
    loaded: false,
    state: "Idle",
    capabilities,
  };
}

function createTraceId(traceId?: string): string {
  return traceId?.trim() || randomUUID();
}

function countTokens(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 1 : trimmed.split(/\s+/).length;
}

function prettifyModelName(modelId: string): string {
  return (
    modelId
      .split("/")
      .at(-1)
      ?.split("-")
      .map((segment) =>
        segment.length === 0 ? segment : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
      )
      .join(" ") ?? modelId
  );
}

function slugifyFileName(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getModelRole(model: RuntimeModelRecord): RuntimeEventRole {
  if (model.capabilities.includes("embeddings") && !model.capabilities.includes("chat")) {
    return "embeddings";
  }

  return "chat";
}

function buildRuntimeKey(modelId: string, role: RuntimeEventRole): RuntimeEventKey {
  return {
    modelId,
    engineType: DEFAULT_ENGINE_TYPE,
    role,
    configHash: DEFAULT_CONFIG_HASH,
  };
}

function getRuntimeKeyForModel(model: RuntimeModelRecord): RuntimeEventKey {
  return buildRuntimeKey(model.id, getModelRole(model));
}

function getRuntimeKeyForLog(modelId?: string, model?: RuntimeModelRecord): RuntimeEventKey {
  if (modelId && model) {
    return getRuntimeKeyForModel(model);
  }

  if (modelId) {
    return buildRuntimeKey(modelId, "tooling");
  }

  return buildRuntimeKey("localhub/system", "tooling");
}

function toLifecycleState(state: WorkerState): RuntimeLifecycleState {
  if (state === "Idle") {
    return "CoolingDown";
  }

  return state;
}

function normalizeTraceMethod(method: string): RuntimeEventTrace["method"] {
  const normalized = method.toUpperCase();

  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return normalized;
  }

  return "GET";
}

function mapRequestRoute(method: string, path: string): RuntimeEventRoute | null {
  const normalizedRoute = `${method.toUpperCase()} ${path}`;

  switch (normalizedRoute) {
    case "GET /healthz":
    case "GET /v1/models":
    case "GET /control/health":
    case "GET /control/models":
    case "POST /v1/chat/completions":
    case "POST /v1/embeddings":
    case "POST /control/models/preload":
    case "POST /control/models/evict":
    case "POST /control/models/register-local":
    case "GET /control/chat/sessions":
    case "GET /control/chat/messages":
    case "POST /control/chat/sessions":
    case "POST /control/chat/run":
    case "GET /control/observability/api-logs":
    case "POST /control/system/shutdown":
    case "GET /control/downloads":
    case "POST /control/downloads":
    case "GET /control/engines":
    case "POST /control/engines":
    case "PUT /config/gateway":
      return normalizedRoute;
    default:
      if (method.toUpperCase() === "PUT" && /^\/config\/models\/[^/]+$/.test(path)) {
        return "PUT /config/models/:id";
      }

      return null;
  }
}

const DEFAULT_MODELS: RuntimeModelRecord[] = [
  createModel("localhub/tinyllama-1.1b-chat-q4", 1_717_286_400, ["chat"]),
  createModel("localhub/qwen2.5-7b-instruct-q4", 1_717_372_800, ["chat", "tools"]),
  createModel("localhub/bge-small-en-v1.5", 1_717_459_200, ["embeddings"]),
];

const DEFAULT_DOWNLOADS: DesktopDownloadList["data"] = [
  {
    id: "download-demo-1",
    provider: "huggingface",
    title: "Qwen2.5 7B Instruct GGUF",
    artifactName: "qwen2.5-7b-instruct-q4_k_m.gguf",
    modelId: "localhub/qwen2.5-7b-instruct-q4",
    status: "downloading",
    progress: 42,
    downloadedBytes: 420,
    totalBytes: 1_000,
    destinationPath: "/tmp/qwen2.5-7b-instruct-q4_k_m.gguf",
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_ENGINES: EngineRecord[] = [
  {
    id: "llama.cpp",
    engineType: "llama.cpp",
    version: "mock-0.1.0",
    channel: "stable",
    installed: true,
    active: true,
    binaryPath: "/mock/bin/llama-server",
    compatibilityNotes: "Mock engine record for desktop shell development.",
    installedAt: new Date(1_717_286_400_000).toISOString(),
  },
];

export class MockGatewayRuntime {
  readonly #apiLogs: ApiLogRecord[] = [];
  readonly #chatMessages = new Map<string, ChatMessage[]>();
  readonly #chatSessions = new Map<string, ChatSession>();
  readonly #modelDetails = new Map<string, DesktopModelRecord>();
  readonly #models = new Map<string, RuntimeModelRecord>();
  readonly #subscribers = new Set<GatewaySubscriber>();
  readonly #telemetryIntervalMs: number;
  readonly #startedAt = Date.now();
  readonly #downloads = [...DEFAULT_DOWNLOADS];
  readonly #engines = [...DEFAULT_ENGINES];

  #telemetryTimer: NodeJS.Timeout | undefined;

  constructor(options: MockGatewayRuntimeOptions) {
    this.#telemetryIntervalMs = options.telemetryIntervalMs;

    for (const model of DEFAULT_MODELS) {
      this.#models.set(model.id, structuredClone(model));
      this.#modelDetails.set(model.id, this.createDesktopModelRecord(model.id));
    }
  }

  start(): void {
    if (this.#telemetryTimer) {
      return;
    }

    this.publishLog("info", "Mock gateway runtime started", undefined, undefined, "system");
    for (const model of this.#models.values()) {
      this.publish(this.createModelStateEvent(model, { reason: "Current runtime snapshot." }));
    }

    this.#telemetryTimer = setInterval(() => {
      this.publish(this.createMetricsEvent());
    }, this.#telemetryIntervalMs);
  }

  stop(): void {
    if (this.#telemetryTimer) {
      clearInterval(this.#telemetryTimer);
      this.#telemetryTimer = undefined;
    }

    this.publishLog("info", "Mock gateway runtime stopped", undefined, undefined, "system");
  }

  subscribe(subscriber: GatewaySubscriber, options: { replay?: boolean } = {}): () => void {
    if (options.replay ?? true) {
      for (const model of this.#models.values()) {
        subscriber(this.createModelStateEvent(model, { reason: "Current runtime snapshot." }));
      }
      subscriber(this.createMetricsEvent());
    }

    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  listModels(): Array<Pick<RuntimeModelRecord, "id" | "object" | "created" | "owned_by">> {
    return this.listRuntimeModels().map(({ id, object, created, owned_by }) => ({
      id,
      object,
      created,
      owned_by,
    }));
  }

  listRuntimeModels(): RuntimeModelRecord[] {
    return Array.from(this.#models.values(), (model) => structuredClone(model));
  }

  listDesktopModels(): DesktopModelRecord[] {
    return Array.from(this.#models.keys(), (modelId) => this.getDesktopModelRecord(modelId));
  }

  listDownloads(): DesktopDownloadList {
    return {
      object: "list",
      data: structuredClone(this.#downloads),
    };
  }

  listChatSessions(): DesktopChatSessionList {
    return {
      object: "list",
      data: [],
    };
  }

  listChatMessages(_sessionId: string): DesktopChatMessageList {
    return {
      object: "list",
      data: [],
    };
  }

  upsertChatSession(
    input: DesktopChatSessionUpsertRequest,
  ): DesktopChatSessionList["data"][number] {
    const now = new Date().toISOString();
    return {
      id: input.id ?? `session_${Date.now()}`,
      ...(input.title ? { title: input.title } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  runChat(input: DesktopChatRunRequest, traceId?: string): DesktopChatRunResponse {
    const session = this.upsertChatSession({
      ...(input.sessionId ? { id: input.sessionId } : {}),
      modelId: input.model,
      title: input.message.slice(0, 80),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    });
    const now = new Date().toISOString();
    const response = this.createChatCompletion(
      {
        model: input.model,
        stream: false,
        messages: [{ role: "user", content: input.message }],
      },
      { traceId: createTraceId(traceId) },
    );

    return {
      session,
      userMessage: {
        id: `message_${Date.now()}`,
        sessionId: session.id,
        role: "user",
        content: input.message,
        toolCalls: [],
        metadata: {},
        createdAt: now,
      },
      assistantMessage: {
        id: `message_${Date.now() + 1}`,
        sessionId: session.id,
        role: "assistant",
        content: response.choices[0]?.message.content as string | null,
        toolCalls: response.choices[0]?.message.tool_calls ?? [],
        metadata: {},
        createdAt: now,
      },
      response,
    };
  }

  listRecentApiLogs(_limit = 30): DesktopApiLogList {
    return {
      object: "list",
      data: [],
    };
  }

  searchCatalog(query: string): DesktopProviderSearchResult {
    const normalized = query.trim().toLowerCase();
    const item = {
      id: "https://example.invalid/mock/qwen2.5-7b-instruct-q4_k_m.gguf",
      provider: "huggingface" as const,
      providerModelId: "mock/qwen2.5-7b-instruct",
      artifactId: "qwen2.5-7b-instruct-q4_k_m",
      title: "Mock Qwen2.5 7B Instruct",
      author: "mock",
      summary: "Fixture provider result from the mock gateway runtime.",
      description: "Fixture provider result from the mock gateway runtime.",
      tags: ["gguf", "chat", "instruct"],
      formats: ["gguf"],
      downloads: 1200,
      likes: 88,
      updatedAt: new Date().toISOString(),
      artifactName: "qwen2.5-7b-instruct-q4_k_m.gguf",
      downloadUrl: "https://example.invalid/qwen2.5-7b-instruct-q4_k_m.gguf",
      sizeBytes: 4_000_000_000,
      quantization: "Q4_K_M",
      architecture: "llama",
      checksumSha256: "a".repeat(64),
      metadata: {},
    };

    return {
      object: "list",
      data: normalized.length === 0 || item.title.toLowerCase().includes(normalized) ? [item] : [],
      warnings: [],
    };
  }

  createDownload(
    input: DesktopDownloadCreateRequest,
    _traceId?: string,
  ): DesktopDownloadActionResponse {
    const task = {
      id: `download-${Date.now()}`,
      provider: input.provider,
      title: input.title,
      artifactName: input.artifactName,
      status: "pending" as const,
      progress: 0,
      downloadedBytes: 0,
      ...(input.sizeBytes !== undefined ? { totalBytes: input.sizeBytes } : {}),
      ...(input.destinationPath ? { destinationPath: input.destinationPath } : {}),
      updatedAt: new Date().toISOString(),
    };

    this.#downloads.unshift(task);
    return {
      accepted: true,
      task,
    };
  }

  pauseDownload(id: string, _traceId?: string): DesktopDownloadActionResponse {
    const task = this.#downloads.find((entry) => entry.id === id);
    if (!task) {
      throw new Error(`Unknown download: ${id}`);
    }

    task.status = "paused";
    task.updatedAt = new Date().toISOString();
    return {
      accepted: true,
      task: structuredClone(task),
    };
  }

  resumeDownload(id: string, _traceId?: string): DesktopDownloadActionResponse {
    const task = this.#downloads.find((entry) => entry.id === id);
    if (!task) {
      throw new Error(`Unknown download: ${id}`);
    }

    task.status = "downloading";
    task.updatedAt = new Date().toISOString();
    return {
      accepted: true,
      task: structuredClone(task),
    };
  }

  listEngines(): EngineRecord[] {
    return structuredClone(this.#engines);
  }

  getHealthSnapshot(plane: GatewayPlane): ControlHealthSnapshot {
    return {
      status: "ok",
      plane,
      uptimeMs: Date.now() - this.#startedAt,
      loadedModelCount: this.getLoadedModelCount(),
      activeWebSocketClients: this.#subscribers.size,
    };
  }

  registerLocalModel(
    input: Parameters<import("../types.js").GatewayRuntime["registerLocalModel"]>[0],
    traceId?: string,
  ): DesktopLocalModelImportResponse {
    const resolvedPath = path.resolve(input.filePath);
    if (path.extname(resolvedPath).toLowerCase() !== ".gguf") {
      throw new Error(`Expected a .gguf artifact, received ${resolvedPath}.`);
    }

    const slug = slugifyFileName(resolvedPath) || `model-${Date.now()}`;
    const modelId = `localhub/${slug}`;
    const created = !this.#models.has(modelId);

    if (created) {
      this.#models.set(modelId, createModel(modelId, Math.floor(Date.now() / 1000), ["chat"]));
    }

    const detail = {
      ...this.createDesktopModelRecord(modelId, {
        displayName: input.displayName?.trim() || undefined,
        localPath: resolvedPath,
      }),
      updatedAt: new Date().toISOString(),
    };
    this.#modelDetails.set(modelId, detail);

    const model = this.#models.get(modelId);
    if (model) {
      this.publish(
        this.createModelStateEvent(model, {
          reason: "Model registered and ready to preload.",
          traceId,
        }),
      );
    }
    this.publishLog(
      "info",
      created ? `Registered mock local model ${modelId}` : `Updated mock local model ${modelId}`,
      traceId,
      modelId,
      "desktop",
    );

    return {
      created,
      model: this.getDesktopModelRecord(modelId),
    };
  }

  preloadModel(modelId: string, traceId?: string): PreloadModelResult {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const alreadyWarm = model.loaded && model.state === "Ready";
    if (alreadyWarm) {
      this.publishLog("info", `Model ${modelId} is already warm`, traceId, modelId);
      return {
        model: structuredClone(model),
        alreadyWarm: true,
      };
    }

    this.transitionModel(model, "Loading", false, traceId, "Model load requested.");
    this.publishLog("info", `Loading model ${modelId}`, traceId, modelId);
    this.transitionModel(model, "Ready", true, traceId, "Model is ready for requests.");

    return {
      model: structuredClone(model),
      alreadyWarm: false,
    };
  }

  evictModel(modelId: string, traceId?: string): EvictModelResult {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const wasLoaded = model.loaded;
    if (!wasLoaded) {
      this.publishLog("info", `Model ${modelId} is already cold`, traceId, modelId);
      return {
        model: structuredClone(model),
        wasLoaded: false,
      };
    }

    this.transitionModel(model, "Unloading", true, traceId, "Model eviction requested.");
    this.publishLog("info", `Evicting model ${modelId}`, traceId, modelId);
    this.transitionModel(model, "Idle", false, traceId, "Model was evicted from memory.");

    return {
      model: structuredClone(model),
      wasLoaded: true,
    };
  }

  createChatCompletion(
    input: ChatCompletionsRequest,
    context: GatewayExecutionContext,
  ): ChatCompletionsResponse {
    const model = this.getModel(input.model);
    if (!model) {
      throw new Error(`Unknown model: ${input.model}`);
    }
    if (!model.capabilities.includes("chat")) {
      throw new GatewayRequestError(
        "unsupported_model_capability",
        `Model ${input.model} does not support chat requests.`,
        409,
      );
    }

    const created = Math.floor(Date.now() / 1000);
    const userText =
      [...input.messages].reverse().find((message) => message.role === "user")?.content ??
      "Hello from the mock gateway";
    const normalizedUserText =
      typeof userText === "string" ? userText : JSON.stringify(userText ?? "");

    this.transitionModel(model, "Busy", true, context.traceId, "Model is serving a request.");

    try {
      if (input.tools?.length) {
        return {
          id: `chatcmpl-${createTraceId(context.traceId)}`,
          object: "chat.completion",
          created,
          model: input.model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `call-${createTraceId(context.traceId)}`,
                    type: "function",
                    function: {
                      name: input.tools[0]?.function.name ?? "tool",
                      arguments: JSON.stringify({ input: normalizedUserText }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: countTokens(normalizedUserText),
            completion_tokens: 1,
            total_tokens: countTokens(normalizedUserText) + 1,
          },
        };
      }

      const answer = `Mock response from ${input.model}: ${normalizedUserText}`;

      return {
        id: `chatcmpl-${createTraceId(context.traceId)}`,
        object: "chat.completion",
        created,
        model: input.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: answer,
            },
          },
        ],
        usage: {
          prompt_tokens: countTokens(normalizedUserText),
          completion_tokens: countTokens(answer),
          total_tokens: countTokens(normalizedUserText) + countTokens(answer),
        },
      };
    } finally {
      this.transitionModel(model, "Ready", true, context.traceId, "Chat completion finished.");
    }
  }

  createChatCompletionStream(
    input: ChatCompletionsRequest,
    context: GatewayExecutionContext,
  ): ChatCompletionsStreamResult {
    const response = this.createChatCompletion({ ...input, stream: false }, context);
    const encoder = new TextEncoder();
    const chunks = [
      `data: ${JSON.stringify({
        id: response.id,
        object: "chat.completion.chunk",
        created: response.created,
        model: response.model,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: response.id,
        object: "chat.completion.chunk",
        created: response.created,
        model: response.model,
        choices: response.choices[0]?.message.tool_calls
          ? [
              {
                index: 0,
                delta: { tool_calls: response.choices[0].message.tool_calls },
                finish_reason: null,
              },
            ]
          : [
              {
                index: 0,
                delta: { content: response.choices[0]?.message.content ?? "" },
                finish_reason: null,
              },
            ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: response.id,
        object: "chat.completion.chunk",
        created: response.created,
        model: response.model,
        choices: [
          { index: 0, delta: {}, finish_reason: response.choices[0]?.finish_reason ?? "stop" },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    return {
      contentType: "text/event-stream; charset=utf-8",
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
    };
  }

  createEmbeddings(
    input: EmbeddingsRequest,
    _context: GatewayExecutionContext,
  ): EmbeddingsResponse {
    const model = this.getModel(input.model);
    if (!model) {
      throw new Error(`Unknown model: ${input.model}`);
    }
    if (!model.capabilities.includes("embeddings")) {
      throw new GatewayRequestError(
        "unsupported_model_capability",
        `Model ${input.model} does not support embeddings requests.`,
        409,
      );
    }

    const values = Array.isArray(input.input) ? input.input : [input.input];
    return {
      object: "list",
      model: input.model,
      data: values.map((value, index) => ({
        object: "embedding",
        index,
        embedding: Array.from({ length: 8 }, (_, position) =>
          Number((((value.length + 1) * (position + 3)) / 100).toFixed(6)),
        ),
      })),
    };
  }

  recordRequestTrace(payload: RequestTraceRecord): void {
    const route = mapRequestRoute(payload.method, payload.path);
    if (!route) {
      return;
    }

    const traceId = createTraceId(payload.requestId);
    const completedAt = new Date().toISOString();
    const receivedAt = new Date(Date.now() - payload.durationMs).toISOString();
    const traceEvent: RuntimeEventTrace = {
      traceId,
      requestId: payload.requestId,
      route,
      method: normalizeTraceMethod(payload.method),
      receivedAt,
      completedAt,
      durationMs: payload.durationMs,
      statusCode: payload.statusCode,
      metadata: {
        path: payload.path,
        plane: payload.plane,
      },
      ...(payload.remoteAddress ? { remoteAddress: payload.remoteAddress } : {}),
    };

    this.publish({
      type: "REQUEST_TRACE",
      ts: completedAt,
      traceId,
      payload: traceEvent,
    });
  }

  private createDesktopModelRecord(
    modelId: string,
    overrides: {
      displayName?: string | undefined;
      localPath?: string | undefined;
    } = {},
  ): DesktopModelRecord {
    const model = this.#models.get(modelId);
    const existing = this.#modelDetails.get(modelId);
    const defaultName = prettifyModelName(modelId);

    return {
      id: modelId,
      name: defaultName,
      displayName: overrides.displayName ?? existing?.displayName ?? defaultName,
      engineType: DEFAULT_ENGINE_TYPE,
      state: toDesktopModelState(model?.state ?? "Idle"),
      loaded: model?.loaded ?? false,
      artifactStatus: "available",
      sizeBytes: existing?.sizeBytes ?? 1_610_612_736,
      format: "gguf",
      capabilities: model?.capabilities ?? existing?.capabilities ?? ["chat"],
      role: getModelRole(model ?? createModel(modelId, Math.floor(Date.now() / 1000), ["chat"])),
      tags: existing?.tags ?? ["mock"],
      localPath:
        overrides.localPath ??
        existing?.localPath ??
        `/mock/models/${slugifyFileName(modelId)}.gguf`,
      sourceKind: "local",
      pinned: existing?.pinned ?? false,
      defaultTtlMs: existing?.defaultTtlMs ?? 900_000,
      contextLength: existing?.contextLength ?? 8192,
      quantization: existing?.quantization ?? "Q4_K_M",
      architecture: existing?.architecture ?? "llama",
      tokenizer: existing?.tokenizer ?? "gpt2",
      checksumSha256: existing?.checksumSha256 ?? "mock-checksum",
      engineVersion: this.#engines[0]?.version,
      engineChannel: this.#engines[0]?.channel,
      lastUsedAt: existing?.lastUsedAt,
      createdAt:
        existing?.createdAt ??
        new Date((model?.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      ...(model?.lastError ? { errorMessage: model.lastError } : {}),
    };
  }

  private getDesktopModelRecord(modelId: string): DesktopModelRecord {
    const updated = this.createDesktopModelRecord(modelId);
    this.#modelDetails.set(modelId, updated);
    return updated;
  }

  private getLoadedModelCount(): number {
    return Array.from(this.#models.values()).filter((model) => model.loaded).length;
  }

  private getModel(modelId: string): RuntimeModelRecord | undefined {
    return this.#models.get(modelId);
  }

  private transitionModel(
    model: RuntimeModelRecord,
    state: WorkerState,
    loaded: boolean,
    traceId?: string,
    reason?: string,
  ): void {
    const previousState = model.state;
    model.state = state;
    model.loaded = loaded;
    model.lastError = state === "Crashed" ? reason : undefined;
    this.publish(this.createModelStateEvent(model, { previousState, reason, traceId }));
  }

  private createModelStateEvent(
    model: RuntimeModelRecord,
    options: ModelStateEventOptions = {},
  ): GatewayEvent {
    const traceId = createTraceId(options.traceId);

    return {
      type: "MODEL_STATE_CHANGED",
      ts: new Date().toISOString(),
      traceId,
      payload: {
        modelId: model.id,
        runtimeKey: getRuntimeKeyForModel(model),
        nextState: toLifecycleState(model.state),
        ...(options.previousState
          ? { previousState: toLifecycleState(options.previousState) }
          : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      },
    };
  }

  private createMetricsEvent(): GatewayEvent {
    const activeWorkers = this.getLoadedModelCount();

    return {
      type: "METRICS_TICK",
      ts: new Date().toISOString(),
      traceId: createTraceId(),
      payload: {
        activeWorkers,
        queuedRequests: 0,
        residentMemoryBytes: activeWorkers * MOCK_RESIDENT_MEMORY_BYTES,
        gpuMemoryBytes: activeWorkers * MOCK_GPU_MEMORY_BYTES,
      },
    };
  }

  private publishLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    traceId?: string,
    modelId?: string,
    source: "gateway" | "worker" | "desktop" | "system" = "gateway",
  ): void {
    const model = modelId ? this.getModel(modelId) : undefined;

    this.publish({
      type: "LOG_STREAM",
      ts: new Date().toISOString(),
      traceId: createTraceId(traceId),
      payload: {
        runtimeKey: getRuntimeKeyForLog(modelId, model),
        level,
        message,
        source,
      },
    });
  }

  private publish(event: GatewayEvent): void {
    const parsedEvent = gatewayEventSchema.parse(event);

    for (const subscriber of this.#subscribers) {
      subscriber(parsedEvent);
    }
  }
}
