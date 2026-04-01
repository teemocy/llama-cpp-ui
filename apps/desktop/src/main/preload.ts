import type {
  DesktopEngineList,
  DesktopLocalModelImportRequest,
  DesktopLocalModelImportResponse,
  DesktopModelLibrary,
  DesktopShellState,
  GatewayEvent,
  GatewayHealthSnapshot,
  PublicModelList,
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
