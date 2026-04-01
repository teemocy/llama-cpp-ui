import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LOCAL_ARTIFACT_LAYOUT_SPEC,
  type RuntimeEnvironment,
  runtimeEnvironmentSchema,
} from "@localhub/shared-contracts";

const APP_SUPPORT_SLUG = "local-llm-hub";
const APP_SUPPORT_NAME = "Local LLM Hub";

export interface ResolveAppPathsOptions {
  cwd?: string;
  environment?: RuntimeEnvironment;
  homeDir?: string;
  supportRoot?: string;
  platform?: NodeJS.Platform;
}

export interface AppPaths {
  environment: RuntimeEnvironment;
  supportRoot: string;
  configDir: string;
  logsDir: string;
  runtimeDir: string;
  dataDir: string;
  downloadsDir: string;
  enginesDir: string;
  modelsDir: string;
  checksumsDir: string;
  promptCachesDir: string;
  promptCacheDir: string;
  tempDir: string;
  gatewayConfigFile: string;
  desktopConfigFile: string;
  discoveryFile: string;
  databaseFile: string;
}

function defaultPackagedSupportRoot(platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", APP_SUPPORT_NAME);
  }

  if (platform === "win32") {
    return path.join(homeDir, "AppData", "Roaming", APP_SUPPORT_NAME);
  }

  return path.join(homeDir, ".config", APP_SUPPORT_SLUG);
}

export function resolveAppPaths(options: ResolveAppPathsOptions = {}): AppPaths {
  const environment = runtimeEnvironmentSchema.parse(
    options.environment ?? process.env.LOCAL_LLM_HUB_ENV ?? "development",
  );
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  const supportRoot =
    options.supportRoot ??
    process.env.LOCAL_LLM_HUB_APP_SUPPORT_DIR ??
    (environment === "development"
      ? path.join(cwd, ".local", APP_SUPPORT_SLUG, "dev")
      : environment === "test"
        ? path.join(cwd, ".local", APP_SUPPORT_SLUG, "test")
        : defaultPackagedSupportRoot(platform, homeDir));

  const configDir = path.join(supportRoot, "config");
  const logsDir = path.join(supportRoot, "logs");
  const runtimeDir = path.join(supportRoot, "runtime");
  const dataDir = path.join(supportRoot, "data");
  const downloadsDir = path.join(
    supportRoot,
    LOCAL_ARTIFACT_LAYOUT_SPEC.directories.downloads.relativePath,
  );
  const enginesDir = path.join(
    supportRoot,
    LOCAL_ARTIFACT_LAYOUT_SPEC.directories.engines.relativePath,
  );
  const modelsDir = path.join(
    supportRoot,
    LOCAL_ARTIFACT_LAYOUT_SPEC.directories.models.relativePath,
  );
  const checksumsDir = path.join(
    supportRoot,
    LOCAL_ARTIFACT_LAYOUT_SPEC.directories.checksums.relativePath,
  );
  const promptCachesDir = path.join(
    supportRoot,
    LOCAL_ARTIFACT_LAYOUT_SPEC.directories.promptCaches.relativePath,
  );
  const tempDir = path.join(supportRoot, LOCAL_ARTIFACT_LAYOUT_SPEC.directories.temp.relativePath);

  return {
    environment,
    supportRoot,
    configDir,
    logsDir,
    runtimeDir,
    dataDir,
    downloadsDir,
    enginesDir,
    modelsDir,
    checksumsDir,
    promptCachesDir,
    // Backward-compatible alias while downstream code migrates to the shared Stage 2 layout names.
    promptCacheDir: promptCachesDir,
    tempDir,
    gatewayConfigFile: path.join(configDir, "gateway.json"),
    desktopConfigFile: path.join(configDir, "desktop.json"),
    discoveryFile: path.join(runtimeDir, "gateway-discovery.json"),
    databaseFile: path.join(dataDir, "gateway.sqlite"),
  };
}

export function ensureAppPaths(paths: AppPaths): AppPaths {
  for (const directory of [
    paths.supportRoot,
    paths.configDir,
    paths.logsDir,
    paths.runtimeDir,
    paths.dataDir,
    paths.downloadsDir,
    paths.enginesDir,
    paths.modelsDir,
    paths.checksumsDir,
    paths.promptCachesDir,
    paths.promptCacheDir,
    paths.tempDir,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}
