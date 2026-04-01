import type {
  DesktopEngineRecord,
  DesktopLocalModelImportRequest,
  DesktopLocalModelImportResponse,
  DesktopModelRecord,
  DesktopShellState,
} from "@localhub/shared-contracts";
import { useState } from "react";

type ModelsScreenProps = {
  engines: DesktopEngineRecord[];
  models: DesktopModelRecord[];
  selectedModelId: string | null;
  shellState: DesktopShellState;
  onSelectModel(modelId: string): void;
  onPickImportFile(): Promise<string | null>;
  onRegisterModel(
    payload: DesktopLocalModelImportRequest,
  ): Promise<DesktopLocalModelImportResponse>;
  onPreloadModel(modelId: string): Promise<void>;
  onEvictModel(modelId: string): Promise<void>;
};

type FeedbackState =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

const formatBytes = (value: number): string => {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue >= 10 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[unitIndex]}`;
};

const formatTime = (value?: string): string => {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
};

const formatTtl = (value: number): string => {
  if (value <= 0) {
    return "Pinned in memory";
  }

  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
};

const humanize = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const describeModel = (model: DesktopModelRecord): string => {
  const facets = [model.role, model.format, model.architecture, model.quantization]
    .filter((value): value is string => Boolean(value))
    .map((value) => humanize(value));

  return facets.length > 0 ? facets.join(" • ") : "Registered local model.";
};

const getStateToneClass = (state: DesktopModelRecord["state"]): string => {
  switch (state) {
    case "ready":
      return "status-pill-positive";
    case "loading":
    case "queued":
      return "status-pill-caution";
    case "evicting":
      return "status-pill-neutral";
    case "error":
      return "status-pill-negative";
    default:
      return "status-pill-neutral";
  }
};

const getArtifactToneClass = (status: DesktopModelRecord["artifactStatus"]): string =>
  status === "available" ? "status-pill-positive" : "status-pill-negative";

export function ModelsScreen({
  engines,
  models,
  selectedModelId,
  shellState,
  onSelectModel,
  onPickImportFile,
  onRegisterModel,
  onPreloadModel,
  onEvictModel,
}: ModelsScreenProps) {
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importDisplayName, setImportDisplayName] = useState("");
  const [pendingImport, setPendingImport] = useState(false);
  const [pendingActionModelId, setPendingActionModelId] = useState<string | null>(null);

  const selectedModel =
    (selectedModelId ? models.find((model) => model.id === selectedModelId) : undefined) ??
    models[0];
  const connected = shellState.phase === "connected";
  const canRegister = connected && Boolean(importFilePath) && !pendingImport;
  const canPreload =
    connected &&
    !!selectedModel &&
    selectedModel.artifactStatus === "available" &&
    selectedModel.state !== "loading" &&
    selectedModel.state !== "ready" &&
    selectedModel.state !== "evicting" &&
    pendingActionModelId !== selectedModel.id;
  const canEvict =
    connected &&
    !!selectedModel &&
    selectedModel.loaded &&
    selectedModel.state !== "evicting" &&
    pendingActionModelId !== selectedModel.id;

  const handlePickImport = async () => {
    setFeedback(null);

    const filePath = await onPickImportFile();
    if (!filePath) {
      return;
    }

    setImportFilePath(filePath);
  };

  const handleRegister = async () => {
    if (!importFilePath) {
      setFeedback({
        tone: "error",
        text: "Choose a local GGUF before trying to register it.",
      });
      return;
    }

    setPendingImport(true);
    setFeedback(null);

    try {
      const result = await onRegisterModel({
        filePath: importFilePath,
        ...(importDisplayName.trim() ? { displayName: importDisplayName.trim() } : {}),
      });

      setImportFilePath(null);
      setImportDisplayName("");
      onSelectModel(result.model.id);
      setFeedback({
        tone: "success",
        text: result.created
          ? `Registered ${result.model.displayName}.`
          : `Updated ${result.model.displayName}.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to register the selected artifact.",
      });
    } finally {
      setPendingImport(false);
    }
  };

  const runModelAction = async (action: "preload" | "evict") => {
    if (!selectedModel) {
      return;
    }

    setPendingActionModelId(selectedModel.id);
    setFeedback(null);

    try {
      if (action === "preload") {
        await onPreloadModel(selectedModel.id);
      } else {
        await onEvictModel(selectedModel.id);
      }

      setFeedback({
        tone: "success",
        text:
          action === "preload"
            ? `Preload requested for ${selectedModel.displayName}.`
            : `Eviction requested for ${selectedModel.displayName}.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : `Unable to ${action} ${selectedModel.displayName}.`,
      });
    } finally {
      setPendingActionModelId(null);
    }
  };

  return (
    <section className="screen-stack">
      <article className="hero-card model-runtime-hero">
        <div>
          <span className="section-label">Model library</span>
          <h3>Manage a live local model end to end</h3>
          <p>
            Register a GGUF from disk, inspect real metadata, and move it between cold and ready
            runtime states without leaving the desktop shell.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => void handlePickImport()} type="button">
            Pick local GGUF
          </button>
          <div className="hero-stat-grid">
            <div className="hero-stat">
              <span className="section-label">Registered</span>
              <strong>{models.length}</strong>
            </div>
            <div className="hero-stat">
              <span className="section-label">Ready now</span>
              <strong>{models.filter((model) => model.state === "ready").length}</strong>
            </div>
          </div>
        </div>
      </article>

      {feedback ? (
        <article
          className={
            feedback.tone === "error"
              ? "wide-card feedback-card feedback-card-error"
              : "wide-card feedback-card"
          }
        >
          <strong>{feedback.tone === "error" ? "Action blocked" : "Action queued"}</strong>
          <p>{feedback.text}</p>
        </article>
      ) : null}

      <div className="models-stage-grid">
        <article className="wide-card library-panel">
          <div className="panel-header">
            <div>
              <span className="section-label">Registered models</span>
              <h3>Inventory</h3>
            </div>
            <p>{connected ? "Select a model to inspect runtime and artifact details." : shellState.message}</p>
          </div>

          {models.length === 0 ? (
            <div className="empty-panel">
              <strong>No local models registered yet.</strong>
              <p>Pick a GGUF and register it to unlock the runtime detail view and preload controls.</p>
            </div>
          ) : (
            <div className="model-list">
              {models.map((model) => (
                <button
                  className={model.id === selectedModel?.id ? "model-list-item model-list-item-active" : "model-list-item"}
                  key={model.id}
                  onClick={() => onSelectModel(model.id)}
                  type="button"
                >
                  <div className="model-card-head">
                    <div>
                      <span className="section-label">{model.engineType}</span>
                      <h4>{model.displayName}</h4>
                    </div>
                    <span className={`status-pill ${getStateToneClass(model.state)}`}>{humanize(model.state)}</span>
                  </div>
                  <p>{describeModel(model)}</p>
                  <dl className="meta-grid compact-meta-grid">
                    <div>
                      <dt>Artifact</dt>
                      <dd>{formatBytes(model.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>{model.contextLength ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{humanize(model.artifactStatus)}</dd>
                    </div>
                    <div>
                      <dt>Last used</dt>
                      <dd>{formatTime(model.lastUsedAt)}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="wide-card detail-panel">
          {selectedModel ? (
            <>
              <div className="panel-header">
                <div>
                  <span className="section-label">Model detail</span>
                  <h3>{selectedModel.displayName}</h3>
                </div>
                <div className="detail-status-row">
                  <span className={`status-pill ${getStateToneClass(selectedModel.state)}`}>
                    {humanize(selectedModel.state)}
                  </span>
                  <span className={`status-pill ${getArtifactToneClass(selectedModel.artifactStatus)}`}>
                    {humanize(selectedModel.artifactStatus)}
                  </span>
                </div>
              </div>

              <p>{describeModel(selectedModel)}</p>

              <div className="detail-actions">
                <button
                  className="primary-button"
                  disabled={!canPreload}
                  onClick={() => void runModelAction("preload")}
                  type="button"
                >
                  {pendingActionModelId === selectedModel.id && selectedModel.state !== "ready"
                    ? "Loading..."
                    : selectedModel.state === "error"
                      ? "Retry preload"
                      : "Preload to memory"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!canEvict}
                  onClick={() => void runModelAction("evict")}
                  type="button"
                >
                  {pendingActionModelId === selectedModel.id && selectedModel.loaded
                    ? "Evicting..."
                    : "Evict from memory"}
                </button>
              </div>

              {selectedModel.errorMessage ? (
                <div className="detail-alert">
                  <strong>Last runtime error</strong>
                  <p>{selectedModel.errorMessage}</p>
                </div>
              ) : null}

              <dl className="meta-grid">
                <div>
                  <dt>Artifact path</dt>
                  <dd>{selectedModel.localPath}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{selectedModel.format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Artifact size</dt>
                  <dd>{formatBytes(selectedModel.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Runtime role</dt>
                  <dd>{humanize(selectedModel.role)}</dd>
                </div>
                <div>
                  <dt>Architecture</dt>
                  <dd>{selectedModel.architecture ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Quantization</dt>
                  <dd>{selectedModel.quantization ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Context length</dt>
                  <dd>{selectedModel.contextLength ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Parameter count</dt>
                  <dd>{selectedModel.parameterCount?.toLocaleString() ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Tokenizer</dt>
                  <dd>{selectedModel.tokenizer ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Warm TTL</dt>
                  <dd>{formatTtl(selectedModel.defaultTtlMs)}</dd>
                </div>
                <div>
                  <dt>Engine version</dt>
                  <dd>{selectedModel.engineVersion ?? "Materializes on first preload"}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{formatTime(selectedModel.lastUsedAt)}</dd>
                </div>
              </dl>

              <div className="pill-row">
                {selectedModel.tags.length > 0 ? selectedModel.tags.map((tag) => (
                  <span className="meta-pill" key={tag}>
                    #{tag}
                  </span>
                )) : <span className="meta-pill meta-pill-muted">No tags</span>}
                {selectedModel.capabilities.map((capability) => (
                  <span className="meta-pill" key={capability}>
                    {humanize(capability)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <strong>Select a registered model.</strong>
              <p>The detail view will surface GGUF metadata, engine information, and lifecycle actions.</p>
            </div>
          )}
        </article>
      </div>

      <div className="screen-grid">
        <article className="info-card">
          <span className="section-label">Import and register</span>
          <h3>Local GGUF intake</h3>
          <p>
            The desktop shell only asks the gateway to register artifacts after you pick them
            through the preload-safe dialog.
          </p>

          <div className="import-preview">
            <strong>Selected artifact</strong>
            <span>{importFilePath ?? "No local GGUF selected yet."}</span>
          </div>

          <label className="field-stack">
            <span className="section-label">Display name override</span>
            <input
              className="text-input"
              onChange={(event) => setImportDisplayName(event.target.value)}
              placeholder="Optional friendly name"
              type="text"
              value={importDisplayName}
            />
          </label>

          <div className="button-row">
            <button className="secondary-button" onClick={() => void handlePickImport()} type="button">
              Choose GGUF
            </button>
            <button
              className="primary-button"
              disabled={!canRegister}
              onClick={() => void handleRegister()}
              type="button"
            >
              {pendingImport ? "Registering..." : "Register model"}
            </button>
          </div>
        </article>

        <article className="info-card">
          <span className="section-label">Engine versions</span>
          <h3>Resolved runtime binaries</h3>
          <p>
            The gateway records the engine version that actually served the worker so the desktop
            detail view can show what is running.
          </p>

          {engines.length === 0 ? (
            <div className="empty-panel compact-empty">
              <strong>No engine versions recorded yet.</strong>
              <p>The first preload will materialize the resolved llama.cpp harness here.</p>
            </div>
          ) : (
            <div className="engine-list">
              {engines.map((engine) => (
                <div className={engine.active ? "engine-card engine-card-active" : "engine-card"} key={engine.id}>
                  <div className="model-card-head">
                    <div>
                      <span className="section-label">{engine.engineType}</span>
                      <h4>{engine.version}</h4>
                    </div>
                    <span className={engine.active ? "status-pill status-pill-positive" : "status-pill status-pill-neutral"}>
                      {engine.active ? "Active" : "Installed"}
                    </span>
                  </div>
                  <p>{engine.compatibilityNotes ?? "Resolved engine binary."}</p>
                  <dl className="meta-grid compact-meta-grid">
                    <div>
                      <dt>Channel</dt>
                      <dd>{engine.channel}</dd>
                    </div>
                    <div>
                      <dt>Installed</dt>
                      <dd>{engine.installed ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
