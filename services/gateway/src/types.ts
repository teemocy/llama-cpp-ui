import type {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  DesktopApiLogList,
  DesktopChatMessageList,
  DesktopChatRunRequest,
  DesktopChatRunResponse,
  DesktopChatSessionList,
  DesktopChatSessionUpsertRequest,
  DesktopDownloadActionResponse,
  DesktopDownloadCreateRequest,
  DesktopDownloadList,
  DesktopEngineRecord,
  DesktopLocalModelImportRequest,
  DesktopLocalModelImportResponse,
  DesktopModelRecord,
  DesktopProviderSearchResult,
  EmbeddingsRequest,
  EmbeddingsResponse,
  RequestRoute,
  RequestTrace,
  RuntimeKey,
  RuntimeRole,
  GatewayEvent as SharedGatewayEvent,
  WorkerLifecycleState,
} from "@localhub/shared-contracts";

export type GatewayPlane = "public" | "control";

export type WorkerState =
  | "Idle"
  | "Loading"
  | "Ready"
  | "Busy"
  | "Unloading"
  | "Crashed"
  | "CoolingDown";

export interface RuntimeModelRecord {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  loaded: boolean;
  state: WorkerState;
  capabilities: string[];
  lastError?: string | undefined;
}

export interface DownloadTaskRecord {
  id: string;
  provider: "huggingface" | "modelscope";
  modelId: string;
  status: "queued" | "running" | "completed";
  progress: number;
}

export type EngineRecord = DesktopEngineRecord;

export type MaybePromise<T> = T | Promise<T>;

export interface ControlHealthSnapshot {
  status: "ok";
  plane: GatewayPlane;
  uptimeMs: number;
  loadedModelCount: number;
  activeWebSocketClients: number;
}

export interface RequestTraceRecord {
  requestId: string;
  plane: GatewayPlane;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  remoteAddress?: string | undefined;
}

export interface PreloadModelResult {
  model: RuntimeModelRecord;
  alreadyWarm: boolean;
}

export interface EvictModelResult {
  model: RuntimeModelRecord;
  wasLoaded: boolean;
}

export interface GatewayExecutionContext {
  traceId: string;
  remoteAddress?: string | undefined;
}

export interface ChatCompletionsStreamResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
}

export type GatewayEvent = SharedGatewayEvent;
export type RuntimeEventRoute = RequestRoute;
export type RuntimeEventTrace = RequestTrace;
export type RuntimeEventKey = RuntimeKey;
export type RuntimeEventRole = RuntimeRole;
export type RuntimeLifecycleState = WorkerLifecycleState;

export class GatewayRequestError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = "GatewayRequestError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface GatewayRuntime {
  start(): MaybePromise<void>;
  stop(): MaybePromise<void>;
  subscribe(subscriber: (event: GatewayEvent) => void, options?: { replay?: boolean }): () => void;
  listModels(): Array<Pick<RuntimeModelRecord, "id" | "object" | "created" | "owned_by">>;
  listRuntimeModels(): RuntimeModelRecord[];
  listDesktopModels(): MaybePromise<DesktopModelRecord[]>;
  listDownloads(): MaybePromise<DesktopDownloadList>;
  listEngines(): EngineRecord[];
  listChatSessions(): MaybePromise<DesktopChatSessionList>;
  listChatMessages(sessionId: string): MaybePromise<DesktopChatMessageList>;
  upsertChatSession(
    input: DesktopChatSessionUpsertRequest,
  ): MaybePromise<DesktopChatSessionList["data"][number]>;
  runChat(input: DesktopChatRunRequest, traceId?: string): MaybePromise<DesktopChatRunResponse>;
  listRecentApiLogs(limit?: number): MaybePromise<DesktopApiLogList>;
  searchCatalog(query: string): MaybePromise<DesktopProviderSearchResult>;
  createDownload(
    input: DesktopDownloadCreateRequest,
    traceId?: string,
  ): MaybePromise<DesktopDownloadActionResponse>;
  pauseDownload(id: string, traceId?: string): MaybePromise<DesktopDownloadActionResponse>;
  resumeDownload(id: string, traceId?: string): MaybePromise<DesktopDownloadActionResponse>;
  getHealthSnapshot(plane: GatewayPlane): ControlHealthSnapshot;
  registerLocalModel(
    input: DesktopLocalModelImportRequest,
    traceId?: string,
  ): MaybePromise<DesktopLocalModelImportResponse>;
  preloadModel(modelId: string, traceId?: string): MaybePromise<PreloadModelResult>;
  evictModel(modelId: string, traceId?: string): MaybePromise<EvictModelResult>;
  createChatCompletion(
    input: ChatCompletionsRequest,
    context: GatewayExecutionContext,
  ): MaybePromise<ChatCompletionsResponse>;
  createChatCompletionStream(
    input: ChatCompletionsRequest,
    context: GatewayExecutionContext,
  ): MaybePromise<ChatCompletionsStreamResult>;
  createEmbeddings(
    input: EmbeddingsRequest,
    context: GatewayExecutionContext,
  ): MaybePromise<EmbeddingsResponse>;
  recordRequestTrace(payload: RequestTraceRecord): void;
}
