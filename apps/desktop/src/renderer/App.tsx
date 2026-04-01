import type {
  DesktopEngineRecord,
  DesktopLocalModelImportRequest,
  DesktopLocalModelImportResponse,
  DesktopModelRecord,
  DesktopShellState,
  GatewayEvent,
  GatewayHealthSnapshot,
  ModelSummary,
} from "@localhub/shared-contracts";
import { startTransition, useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { ChatScreen } from "./screens/ChatScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ModelsScreen } from "./screens/ModelsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type DesktopSystemPaths = {
  workspaceRoot: string;
  supportDir: string;
  discoveryFile: string;
};

const initialShellState: DesktopShellState = {
  phase: "idle",
  progress: 0,
  message: "Renderer waiting for preload bridge.",
  discovery: null,
  lastError: null,
  startedAt: null,
  lastEventAt: null,
};

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/models", label: "Model Library" },
  { to: "/chat", label: "Chat Sandbox" },
  { to: "/settings", label: "Settings" },
] as const;

const formatClock = (value?: string | null): string => {
  if (!value) {
    return "Not yet";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

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

const describeModel = (model: DesktopModelRecord): string => {
  const facets = [model.role, model.format, model.architecture, model.quantization]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/-/g, " "));

  return facets.length > 0 ? facets.join(" • ") : "Registered local model.";
};

const toModelSummary = (model: DesktopModelRecord): ModelSummary => ({
  id: model.id,
  name: model.displayName,
  engine: model.engineType,
  state: model.state,
  sizeLabel: formatBytes(model.sizeBytes),
  tags: model.tags,
  ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
  description: describeModel(model),
  ...(model.lastUsedAt ? { lastUsedAt: model.lastUsedAt } : {}),
});

export function App() {
  const [shellState, setShellState] = useState(initialShellState);
  const [modelLibrary, setModelLibrary] = useState<DesktopModelRecord[]>([]);
  const [engines, setEngines] = useState<DesktopEngineRecord[]>([]);
  const [health, setHealth] = useState<GatewayHealthSnapshot | null>(null);
  const [paths, setPaths] = useState<DesktopSystemPaths | null>(null);
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    void window.desktopApi.shell.getState().then((state) => {
      if (!disposed) {
        setShellState(state);
      }
    });

    void window.desktopApi.system.getPaths().then((value) => {
      if (!disposed) {
        setPaths(value);
      }
    });

    const unsubscribeState = window.desktopApi.shell.onStateChange((state) => {
      startTransition(() => {
        setShellState(state);
      });
    });

    const unsubscribeEvents = window.desktopApi.gateway.subscribeEvents((event) => {
      startTransition(() => {
        setEvents((current) => [event, ...current].slice(0, 14));
      });

      if (event.type === "MODEL_STATE_CHANGED") {
        startTransition(() => {
          setRefreshKey((current) => current + 1);
        });
      }
    });

    return () => {
      disposed = true;
      unsubscribeState();
      unsubscribeEvents();
    };
  }, []);

  useEffect(() => {
    if (shellState.phase !== "connected") {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const [library, engineList, healthSnapshot] = await Promise.all([
        window.desktopApi.gateway.listModelLibrary(),
        window.desktopApi.gateway.listEngines(),
        window.desktopApi.gateway.getHealth(),
      ]);

      if (!cancelled) {
        setModelLibrary(library.data);
        setEngines(engineList.data);
        setHealth(healthSnapshot);
      }
    };

    void refresh();

    const interval = window.setInterval(() => {
      void refresh();
    }, 7_500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshKey, shellState.phase]);

  useEffect(() => {
    if (modelLibrary.length === 0) {
      setSelectedModelId(null);
      return;
    }

    setSelectedModelId((current) =>
      current && modelLibrary.some((model) => model.id === current)
        ? current
        : modelLibrary[0]!.id,
    );
  }, [modelLibrary]);

  const latestMetrics = events.find((event) => event.type === "METRICS_TICK");
  const latestTrace = events.find((event) => event.type === "REQUEST_TRACE");
  const latestMetricsPayload = latestMetrics?.payload as Record<string, unknown> | undefined;
  const latestTracePayload = latestTrace?.payload as Record<string, unknown> | undefined;
  const modelSummaries = modelLibrary.map((model) => toModelSummary(model));
  const activeEngineCount = engines.filter((engine) => engine.active).length;

  const requestRefresh = () => {
    startTransition(() => {
      setRefreshKey((current) => current + 1);
    });
  };

  const pickLocalModel = async (): Promise<string | null> => {
    const result = await window.desktopApi.gateway.openModelFileDialog();
    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  };

  const registerLocalModel = async (
    payload: DesktopLocalModelImportRequest,
  ): Promise<DesktopLocalModelImportResponse> => {
    const result = await window.desktopApi.gateway.registerLocalModel(payload);

    setSelectedModelId(result.model.id);
    requestRefresh();

    return result;
  };

  const preloadModel = async (modelId: string): Promise<void> => {
    await window.desktopApi.gateway.preloadModel(modelId);
    requestRefresh();
  };

  const evictModel = async (modelId: string): Promise<void> => {
    await window.desktopApi.gateway.evictModel(modelId);
    requestRefresh();
  };

  return (
    <HashRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-card">
            <span className="brand-eyebrow">Stage 2 Runtime Slice</span>
            <h1>Local LLM Hub</h1>
            <p>Real local model registration, metadata-driven details, and live preload or evict controls.</p>
          </div>

          <nav className="nav-stack">
            {navItems.map((item) => (
              <NavLink
                className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
                end={item.to === "/"}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <section className="side-panel">
            <span className="section-label">Gateway</span>
            <div className="status-chip">{shellState.phase.replaceAll("_", " ")}</div>
            <p>{shellState.message}</p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${shellState.progress}%` }} />
            </div>
            <small>Last event: {formatClock(shellState.lastEventAt)}</small>
          </section>

          <section className="side-panel">
            <span className="section-label">Runtime pulse</span>
            <strong>
              {typeof latestMetricsPayload?.activeWorkers === "number"
                ? `${latestMetricsPayload.activeWorkers} active worker slots`
                : "Waiting for telemetry"}
            </strong>
            <p>
              {typeof latestTracePayload?.route === "string"
                ? `Latest traced route: ${latestTracePayload.route}.`
                : "The control plane will trace lifecycle requests once the first action runs."}
            </p>
          </section>
        </aside>

        <main className="content-shell">
          <header className="topbar">
            <div>
              <span className="section-label">Connection</span>
              <h2>{shellState.discovery?.publicBaseUrl ?? "Waiting for discovery"}</h2>
            </div>
            <div className="topbar-meta">
              <div>
                <span className="section-label">Started</span>
                <strong>{formatClock(shellState.startedAt)}</strong>
              </div>
              <div>
                <span className="section-label">Registered models</span>
                <strong>{modelLibrary.length}</strong>
              </div>
              <div>
                <span className="section-label">Active engines</span>
                <strong>{activeEngineCount}</strong>
              </div>
            </div>
          </header>

          <Routes>
            <Route
              path="/"
              element={<DashboardScreen events={events} health={health} shellState={shellState} />}
            />
            <Route
              path="/models"
              element={
                <ModelsScreen
                  engines={engines}
                  models={modelLibrary}
                  onEvictModel={evictModel}
                  onPickImportFile={pickLocalModel}
                  onPreloadModel={preloadModel}
                  onRegisterModel={registerLocalModel}
                  onSelectModel={setSelectedModelId}
                  selectedModelId={selectedModelId}
                  shellState={shellState}
                />
              }
            />
            <Route
              path="/chat"
              element={<ChatScreen models={modelSummaries} shellState={shellState} />}
            />
            <Route
              path="/settings"
              element={<SettingsScreen paths={paths} shellState={shellState} />}
            />
          </Routes>
        </main>

        <aside className="activity-rail">
          <div className="rail-card">
            <span className="section-label">Event feed</span>
            <h3>Shared envelope</h3>
            <p>
              Runtime state, desktop actions, and control-plane traces all flow through the same
              shared event contract.
            </p>
          </div>

          <div className="event-list">
            {events.length === 0 ? (
              <div className="event-card event-card-empty">
                Waiting for gateway telemetry to populate the feed.
              </div>
            ) : (
              events.map((event) => (
                <article className="event-card" key={`${event.traceId}-${event.ts}`}>
                  <div className="event-head">
                    <strong>{event.type}</strong>
                    <span>{formatClock(event.ts)}</span>
                  </div>
                  <p>
                    {event.type === "LOG_STREAM"
                      ? ((event.payload as { message?: string }).message ?? "Gateway log")
                      : (JSON.stringify(event.payload) ?? "")}
                  </p>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </HashRouter>
  );
}
