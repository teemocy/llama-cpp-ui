export const preloadBridgeContract = {
  version: 1,
  channels: [
    "gateway:discovery",
    "gateway:subscribe-events",
    "gateway:list-model-library",
    "gateway:register-local-model",
    "gateway:preload-model",
    "gateway:evict-model",
    "gateway:shutdown",
    "gateway:get-catalog-model",
  ] as const,
};

export type PreloadBridgeChannel = (typeof preloadBridgeContract.channels)[number];
