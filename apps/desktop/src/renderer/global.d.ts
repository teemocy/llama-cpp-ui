import type {
  ChatSession,
  DesktopApiLogList,
  DesktopChatMessageList,
  DesktopChatRunRequest,
  DesktopChatRunResponse,
  DesktopChatSessionList,
  DesktopChatSessionUpsertRequest,
  DesktopDownloadActionResponse,
  DesktopDownloadCreateRequest,
  DesktopDownloadList,
  DesktopEngineList,
  DesktopLocalModelImportRequest,
  DesktopLocalModelImportResponse,
  DesktopModelLibrary,
  DesktopProviderCatalogDetailResponse,
  DesktopProviderSearchResult,
  DesktopShellState,
  GatewayEvent,
  GatewayHealthSnapshot,
  PublicModelList,
} from "@localhub/shared-contracts";

type DesktopSystemPaths = {
  workspaceRoot: string;
  supportDir: string;
  discoveryFile: string;
};

type FileDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

type Unsubscribe = () => void;

type DesktopApi = {
  shell: {
    getState(): Promise<DesktopShellState>;
    onStateChange(listener: (state: DesktopShellState) => void): Unsubscribe;
  };
  gateway: {
    listModels(): Promise<PublicModelList>;
    listModelLibrary(): Promise<DesktopModelLibrary>;
    getHealth(): Promise<GatewayHealthSnapshot>;
    listEngines(): Promise<DesktopEngineList>;
    registerLocalModel(payload: DesktopLocalModelImportRequest): Promise<DesktopLocalModelImportResponse>;
    preloadModel(modelId: string): Promise<void>;
    evictModel(modelId: string): Promise<void>;
    listChatSessions(): Promise<DesktopChatSessionList>;
    listChatMessages(sessionId: string): Promise<DesktopChatMessageList>;
    upsertChatSession(payload: DesktopChatSessionUpsertRequest): Promise<ChatSession>;
    runChat(payload: DesktopChatRunRequest): Promise<DesktopChatRunResponse>;
    listApiLogs(limit?: number): Promise<DesktopApiLogList>;
    searchCatalog(query: string): Promise<DesktopProviderSearchResult>;
    getCatalogModel(
      provider: "huggingface" | "modelscope",
      providerModelId: string,
    ): Promise<DesktopProviderCatalogDetailResponse>;
    listDownloads(): Promise<DesktopDownloadList>;
    createDownload(payload: DesktopDownloadCreateRequest): Promise<DesktopDownloadActionResponse>;
    pauseDownload(id: string): Promise<DesktopDownloadActionResponse>;
    resumeDownload(id: string): Promise<DesktopDownloadActionResponse>;
    subscribeEvents(listener: (event: GatewayEvent) => void): Unsubscribe;
    openModelFileDialog(): Promise<FileDialogResult>;
  };
  system: {
    getPaths(): Promise<DesktopSystemPaths>;
  };
};

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
