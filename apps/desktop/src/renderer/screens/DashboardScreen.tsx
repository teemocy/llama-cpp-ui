import type {
  ApiLogRecord,
  DesktopShellState,
  GatewayEvent,
  GatewayHealthSnapshot,
} from "@localhub/shared-contracts";
import { useEffect, useState } from "react";

type DashboardScreenProps = {
  shellState: DesktopShellState;
  health: GatewayHealthSnapshot | null;
  events: GatewayEvent[];
};

const findNumericMetric = (events: GatewayEvent[], key: string): number | null => {
  const event = events.find((entry) => entry.type === "METRICS_TICK");
  const payload = event?.payload as Record<string, unknown> | undefined;
  const value = payload?.[key];
  return typeof value === "number" ? value : null;
};

const formatRate = (value: number | undefined): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Pending";
  }

  return `${value.toFixed(2)} tok/s`;
};

export function DashboardScreen({ shellState, health, events }: DashboardScreenProps) {
  const [apiLogs, setApiLogs] = useState<ApiLogRecord[]>([]);
  const latestTrace = events.find((event) => event.type === "REQUEST_TRACE");
  const latestTracePayload = latestTrace?.payload as Record<string, unknown> | undefined;
  const healthRecord = health as Record<string, unknown> | null;
  const healthState =
    typeof healthRecord?.state === "string"
      ? healthRecord.state
      : typeof healthRecord?.status === "string"
        ? healthRecord.status
        : shellState.phase;
  const activeWorkers =
    typeof healthRecord?.activeWorkers === "number"
      ? healthRecord.activeWorkers
      : typeof healthRecord?.loadedModelCount === "number"
        ? healthRecord.loadedModelCount
        : 0;
  const runtimeLogs = events.filter((event) => event.type === "LOG_STREAM").slice(0, 10);
  const latestApiLog = apiLogs[0];
  const residentMemoryBytes = findNumericMetric(events, "residentMemoryBytes");
  const gpuMemoryBytes = findNumericMetric(events, "gpuMemoryBytes");

  useEffect(() => {
    if (shellState.phase !== "connected") {
      return;
    }

    let cancelled = false;
    const refreshLogs = async () => {
      const response = await window.desktopApi.gateway.listApiLogs(30);
      if (!cancelled) {
        setApiLogs(response.data);
      }
    };

    void refreshLogs();
    const timer = window.setInterval(() => {
      void refreshLogs();
    }, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shellState.phase]);

  return (
    <section className="screen-grid">
      <article className="hero-card">
        <span className="section-label">Runtime overview</span>
        <h3>Live gateway observability</h3>
        <p>
          Track request traces, gateway logs, and token metrics while model runtime requests are in
          flight.
        </p>
      </article>

      <article className="info-card">
        <span className="section-label">Gateway phase</span>
        <strong>{healthState}</strong>
        <p>{shellState.message}</p>
      </article>

      <article className="info-card">
        <span className="section-label">Active workers</span>
        <strong>{activeWorkers}</strong>
        <p>The shell is consuming adapted control-plane health snapshots.</p>
      </article>

      <article className="info-card">
        <span className="section-label">Resident memory</span>
        <strong>{residentMemoryBytes !== null ? `${residentMemoryBytes} bytes` : "Pending"}</strong>
        <p>GPU memory: {gpuMemoryBytes !== null ? `${gpuMemoryBytes} bytes` : "Pending"}</p>
      </article>

      <article className="info-card">
        <span className="section-label">Latest trace</span>
        <strong>
          {typeof latestTracePayload?.route === "string" ? latestTracePayload.route : "Pending"}
        </strong>
        <p>Request traces are already flowing through the same telemetry rail.</p>
      </article>

      <article className="wide-card">
        <span className="section-label">API performance</span>
        <h3>Recent completion stats</h3>
        {latestApiLog ? (
          <dl className="meta-grid">
            <div>
              <dt>Endpoint</dt>
              <dd>{latestApiLog.endpoint}</dd>
            </div>
            <div>
              <dt>TTFT</dt>
              <dd>
                {latestApiLog.ttftMs !== undefined ? `${latestApiLog.ttftMs} ms` : "Pending"}
              </dd>
            </div>
            <div>
              <dt>Tokens/s</dt>
              <dd>{formatRate(latestApiLog.tokensPerSecond)}</dd>
            </div>
            <div>
              <dt>Total duration</dt>
              <dd>
                {latestApiLog.totalDurationMs !== undefined
                  ? `${latestApiLog.totalDurationMs} ms`
                  : "Pending"}
              </dd>
            </div>
          </dl>
        ) : (
          <p>No API logs yet. Run chat requests to populate this panel.</p>
        )}
      </article>

      <article className="wide-card">
        <span className="section-label">Live log console</span>
        <h3>Gateway event stream</h3>
        <div className="log-console">
          {runtimeLogs.length === 0 ? (
            <p>Waiting for runtime log events.</p>
          ) : (
            runtimeLogs.map((event) => (
              <p key={`${event.traceId}-${event.ts}`}>
                [{new Date(event.ts).toLocaleTimeString()}]{" "}
                {(event.payload as { message?: string }).message ?? "Gateway log"}
              </p>
            ))
          )}
        </div>
      </article>
    </section>
  );
}
