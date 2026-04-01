export const IPC_CHANNELS = {
  shellGetState: "shell:get-state",
  shellStateChanged: "shell:state-changed",
  gatewayListModels: "gateway:list-models",
  gatewayListModelLibrary: "gateway:list-model-library",
  gatewayGetHealth: "gateway:get-health",
  gatewayListEngines: "gateway:list-engines",
  gatewayRegisterLocalModel: "gateway:register-local-model",
  gatewayPreloadModel: "gateway:preload-model",
  gatewayEvictModel: "gateway:evict-model",
  gatewayEvent: "gateway:event",
  gatewayOpenModelDialog: "gateway:open-model-dialog",
  systemGetPaths: "system:get-paths",
} as const;
