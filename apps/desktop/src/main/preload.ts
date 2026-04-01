import type {
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
  DesktopProviderSearchResult,
  DesktopShellState,
  GatewayEvent,
  GatewayHealthSnapshot,
  PublicModelList,
  ChatSession,
} from "@localhub/shared-contracts";
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./channels";
import type { DesktopSystemPaths } from "./gateway-manager";

type FileDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

type Listener<T> = (payload: T) => void;

const subscribe = <T>(channel: string, listener: Listener<T>) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrapped);

  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const api = {
  shell: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.shellGetState) as Promise<DesktopShellState>,
    onStateChange: (listener: Listener<DesktopShellState>) =>
      subscribe(IPC_CHANNELS.shellStateChanged, listener),
  },
  gateway: {
    listModels: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListModels) as Promise<PublicModelList>,
    listModelLibrary: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListModelLibrary) as Promise<DesktopModelLibrary>,
    getHealth: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayGetHealth) as Promise<GatewayHealthSnapshot>,
    listEngines: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListEngines) as Promise<DesktopEngineList>,
    registerLocalModel: (payload: DesktopLocalModelImportRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayRegisterLocalModel, payload) as Promise<DesktopLocalModelImportResponse>,
    preloadModel: (modelId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayPreloadModel, modelId) as Promise<void>,
    evictModel: (modelId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayEvictModel, modelId) as Promise<void>,
    listChatSessions: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListChatSessions) as Promise<DesktopChatSessionList>,
    listChatMessages: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListChatMessages, sessionId) as Promise<DesktopChatMessageList>,
    upsertChatSession: (payload: DesktopChatSessionUpsertRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayUpsertChatSession, payload) as Promise<ChatSession>,
    runChat: (payload: DesktopChatRunRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayRunChat, payload) as Promise<DesktopChatRunResponse>,
    listApiLogs: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListApiLogs, limit) as Promise<DesktopApiLogList>,
    searchCatalog: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewaySearchCatalog, query) as Promise<DesktopProviderSearchResult>,
    listDownloads: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayListDownloads) as Promise<DesktopDownloadList>,
    createDownload: (payload: DesktopDownloadCreateRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayCreateDownload, payload) as Promise<DesktopDownloadActionResponse>,
    pauseDownload: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayPauseDownload, id) as Promise<DesktopDownloadActionResponse>,
    resumeDownload: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayResumeDownload, id) as Promise<DesktopDownloadActionResponse>,
    subscribeEvents: (listener: Listener<GatewayEvent>) =>
      subscribe(IPC_CHANNELS.gatewayEvent, listener),
    openModelFileDialog: () =>
      ipcRenderer.invoke(IPC_CHANNELS.gatewayOpenModelDialog) as Promise<FileDialogResult>,
  },
  system: {
    getPaths: () => ipcRenderer.invoke(IPC_CHANNELS.systemGetPaths) as Promise<DesktopSystemPaths>,
  },
};

contextBridge.exposeInMainWorld("desktopApi", api);
