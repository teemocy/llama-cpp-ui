import type {
  ChatMessage,
  ChatSession,
  DesktopShellState,
  ModelSummary,
} from "@localhub/shared-contracts";
import { startTransition, useEffect, useMemo, useState } from "react";

type ChatScreenProps = {
  shellState: DesktopShellState;
  models: ModelSummary[];
};

const createTempMessage = (
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage => ({
  id: `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sessionId,
  role,
  content,
  toolCalls: [],
  metadata: {},
  createdAt: new Date().toISOString(),
});

const sortByUpdatedDesc = (sessions: ChatSession[]): ChatSession[] =>
  [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export function ChatScreen({ shellState, models }: ChatScreenProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(models[0]?.id ?? "");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const activeSessionTitle = activeSession?.title ?? "Untitled chat";
  const activeSessionUpdatedAt = activeSession
    ? new Date(activeSession.updatedAt).toLocaleString()
    : "Create a session or send a prompt to start one.";
  const sessionStatusLabel = activeSession ? "Active session" : "No session selected";

  useEffect(() => {
    if (models.length === 0) {
      setSelectedModelId("");
      return;
    }

    setSelectedModelId((current) => (current ? current : models[0]!.id));
  }, [models]);

  useEffect(() => {
    if (shellState.phase !== "connected") {
      return;
    }

    let cancelled = false;
    const refreshSessions = async () => {
      try {
        const response = await window.desktopApi.gateway.listChatSessions();
        if (cancelled) {
          return;
        }

        const sorted = sortByUpdatedDesc(response.data);
        setSessions(sorted);
        setActiveSessionId((current) => {
          if (current && sorted.some((session) => session.id === current)) {
            return current;
          }

          return sorted[0]?.id ?? null;
        });
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load sessions.");
        }
      }
    };

    void refreshSessions();
    return () => {
      cancelled = true;
    };
  }, [shellState.phase]);

  useEffect(() => {
    if (!activeSessionId || shellState.phase !== "connected") {
      setMessages([]);
      return;
    }

    let cancelled = false;
    const refreshMessages = async () => {
      try {
        const response = await window.desktopApi.gateway.listChatMessages(activeSessionId);
        if (cancelled) {
          return;
        }

        setMessages(response.data);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load messages.");
        }
      }
    };

    void refreshMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, shellState.phase]);

  useEffect(() => {
    if (!activeSession) {
      setSystemPrompt("");
      setSessionTitleDraft("");
      return;
    }

    if (activeSession.modelId) {
      setSelectedModelId(activeSession.modelId);
    }
    setSystemPrompt(activeSession.systemPrompt ?? "");
    setSessionTitleDraft(activeSession.title ?? "");
  }, [activeSession]);

  const ensureSession = async (): Promise<ChatSession> => {
    const next = await window.desktopApi.gateway.upsertChatSession({
      ...(activeSessionId ? { id: activeSessionId } : {}),
      ...(selectedModelId ? { modelId: selectedModelId } : {}),
      title: sessionTitleDraft.trim(),
      systemPrompt: systemPrompt.trim(),
    });
    startTransition(() => {
      setSessions((current) =>
        sortByUpdatedDesc([next, ...current.filter((item) => item.id !== next.id)]),
      );
      setActiveSessionId(next.id);
    });
    return next;
  };

  const saveSessionConfig = async () => {
    if (sessionActionBusy) {
      return;
    }

    setSessionActionBusy(true);

    try {
      setError(null);
      await ensureSession();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save session settings.");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const sendMessage = async () => {
    if (
      busy ||
      sessionActionBusy ||
      shellState.phase !== "connected" ||
      draft.trim().length === 0 ||
      !selectedModelId
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const session = await ensureSession();
      const content = draft.trim();
      setDraft("");

      const tempUser = createTempMessage(session.id, "user", content);
      const tempAssistant = createTempMessage(session.id, "assistant", "");
      setMessages((current) => [...current, tempUser, tempAssistant]);

      const result = await window.desktopApi.gateway.runChat({
        sessionId: session.id,
        model: selectedModelId,
        systemPrompt: systemPrompt.trim(),
        message: content,
      });

      const assistantText = result.assistantMessage.content ?? "";
      if (!assistantText) {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempAssistant.id ? result.assistantMessage : message,
          ),
        );
      } else {
        let cursor = 0;
        await new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            cursor += 16;
            const partial = assistantText.slice(0, cursor);
            setMessages((current) =>
              current.map((message) =>
                message.id === tempAssistant.id
                  ? { ...result.assistantMessage, content: partial }
                  : message,
              ),
            );

            if (cursor >= assistantText.length) {
              window.clearInterval(timer);
              resolve();
            }
          }, 24);
        });
      }

      setMessages((current) =>
        current.map((message) => {
          if (message.id === tempUser.id) {
            return result.userMessage;
          }
          if (message.id === tempAssistant.id) {
            return result.assistantMessage;
          }
          return message;
        }),
      );
      setSessions((current) =>
        sortByUpdatedDesc([
          result.session,
          ...current.filter((item) => item.id !== result.session.id),
        ]),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to run chat.");
    } finally {
      setBusy(false);
    }
  };

  const createSession = async () => {
    if (sessionActionBusy) {
      return;
    }

    setSessionActionBusy(true);

    try {
      setError(null);
      const next = await window.desktopApi.gateway.upsertChatSession({
        modelId: selectedModelId || undefined,
        title: sessionTitleDraft.trim(),
        systemPrompt: systemPrompt.trim(),
      });
      setSessions((current) =>
        sortByUpdatedDesc([next, ...current.filter((item) => item.id !== next.id)]),
      );
      setActiveSessionId(next.id);
      setMessages([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create session.");
    } finally {
      setSessionActionBusy(false);
    }
  };

  const deleteSession = async () => {
    if (!activeSessionId || sessionActionBusy) {
      return;
    }

    const sessionLabel = sessionTitleDraft.trim() || activeSessionTitle;
    if (
      !window.confirm(
        `Delete "${sessionLabel}"? This will remove the session and all of its messages.`,
      )
    ) {
      return;
    }

    setSessionActionBusy(true);

    try {
      setError(null);
      await window.desktopApi.gateway.deleteChatSession(activeSessionId);
      const response = await window.desktopApi.gateway.listChatSessions();

      startTransition(() => {
        const sorted = sortByUpdatedDesc(response.data);
        setSessions(sorted);
        setActiveSessionId((current) => {
          if (current && sorted.some((session) => session.id === current)) {
            return current;
          }

          return sorted[0]?.id ?? null;
        });
        setMessages([]);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete session.");
    } finally {
      setSessionActionBusy(false);
    }
  };

  return (
    <section className="chat-layout">
      <article className="info-card chat-session-list">
        <div className="panel-header">
          <div>
            <span className="section-label">Sessions</span>
            <h3>Persistent history</h3>
            <p>Keep recent sessions within reach and switch without losing context.</p>
          </div>
          <button
            className="secondary-button"
            disabled={shellState.phase !== "connected" || busy || sessionActionBusy}
            onClick={() => void createSession()}
            type="button"
          >
            New session
          </button>
        </div>
        <div className="model-list">
          {sessions.length === 0 ? (
            <div className="empty-panel compact-empty">
              <strong>No saved sessions yet.</strong>
              <p>Send a prompt to start your first chat transcript.</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                className={
                  session.id === activeSessionId
                    ? "model-list-item model-list-item-active"
                    : "model-list-item"
                }
                disabled={shellState.phase !== "connected" || busy || sessionActionBusy}
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                type="button"
              >
                <h4>{session.title ?? "Untitled chat"}</h4>
                <p>{new Date(session.updatedAt).toLocaleString()}</p>
              </button>
            ))
          )}
        </div>
      </article>

      <article className="info-card chat-main-panel">
        <div className="chat-session-banner">
          <div className="chat-session-copy">
            <span className="section-label">{sessionStatusLabel}</span>
            <input
              className="text-input chat-session-title-input"
              onChange={(event) => setSessionTitleDraft(event.target.value)}
              placeholder={activeSessionTitle}
              value={sessionTitleDraft}
            />
            <p>{activeSessionUpdatedAt}</p>
          </div>
          <div className="chat-session-meta">
            <span className="status-pill status-pill-neutral">
              {selectedModel?.name ?? "No model selected"}
            </span>
            <span className="meta-pill meta-pill-muted">{messages.length} messages</span>
          </div>
        </div>

        <div className="chat-session-actions">
          <button
            className="secondary-button"
            disabled={
              shellState.phase !== "connected" || !activeSession || busy || sessionActionBusy
            }
            onClick={() => void saveSessionConfig()}
            type="button"
          >
            Save session
          </button>
          <button
            className="secondary-button danger-button"
            disabled={
              shellState.phase !== "connected" || !activeSession || busy || sessionActionBusy
            }
            onClick={() => void deleteSession()}
            type="button"
          >
            Delete session
          </button>
        </div>

        <div className="chat-controls">
          <label className="field-stack">
            <span className="section-label">Model</span>
            <select
              className="text-input"
              onChange={(event) => setSelectedModelId(event.target.value)}
              value={selectedModelId}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span className="section-label">System prompt</span>
            <textarea
              className="text-input"
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Optional system instruction"
              rows={3}
              value={systemPrompt}
            />
          </label>
          <div className="button-row">
            <span className="status-chip">Gateway {shellState.phase}</span>
          </div>
        </div>

        <div className="chat-thread">
          {messages.length === 0 ? (
            <div className="empty-panel compact-empty">
              <strong>Chat sandbox is ready.</strong>
              <p>Choose a model, enter a prompt, and your transcript will persist per session.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article className="chat-bubble" data-role={message.role} key={message.id}>
                <strong>{message.role}</strong>
                <p>{message.content ?? ""}</p>
              </article>
            ))
          )}
        </div>

        <div className="chat-composer">
          <textarea
            className="text-input"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Send a message"
            rows={3}
            value={draft}
          />
          <div className="button-row">
            <button
              className="primary-button"
              disabled={
                shellState.phase !== "connected" ||
                busy ||
                sessionActionBusy ||
                draft.trim().length === 0
              }
              onClick={() => void sendMessage()}
              type="button"
            >
              {busy ? "Generating..." : "Send"}
            </button>
            {error ? <span className="status-pill status-pill-negative">{error}</span> : null}
          </div>
        </div>
      </article>
    </section>
  );
}
