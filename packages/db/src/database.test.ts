import { afterEach, describe, expect, it } from "vitest";

import {
  ApiTokensRepository,
  ChatRepository,
  DownloadTasksRepository,
  EngineVersionsRepository,
  ModelsRepository,
  PromptCachesRepository,
  createRepositoryFixtureSet,
  createTestDatabase,
  fixtureApiLog,
  fixtureApiTokenRecord,
  fixtureChatMessage,
  fixtureChatSession,
  fixtureDownloadTask,
  fixtureEngineVersion,
  fixtureModelArtifact,
  fixtureModelProfile,
  fixturePromptCacheRecord,
  fixtureRequestTrace,
  pruneApiLogs,
  requestTraceToApiLogRecord,
  runCoreRuntimeRetention,
} from "./index.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("db foundation", () => {
  it("applies the baseline migrations", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const row = testDatabase.database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };

    expect(row.count).toBe(3);
    expect(testDatabase.filePath.endsWith("gateway.sqlite")).toBe(true);
  });

  it("persists core operational records", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const models = new ModelsRepository(testDatabase.database);
    const engines = new EngineVersionsRepository(testDatabase.database);
    const downloads = new DownloadTasksRepository(testDatabase.database);
    const promptCaches = new PromptCachesRepository(testDatabase.database);
    const tokens = new ApiTokensRepository(testDatabase.database);

    models.save(fixtureModelArtifact, fixtureModelProfile);
    models.markLoaded(fixtureModelArtifact.id, "2026-03-31T12:15:00.000Z");
    engines.upsert(fixtureEngineVersion);
    downloads.upsert(fixtureDownloadTask);
    promptCaches.upsert(fixturePromptCacheRecord, { source: "test" });
    tokens.upsert(fixtureApiTokenRecord);

    const storedModel = models.findById(fixtureModelArtifact.id);
    const storedPromptCache = promptCaches.findByCacheKey(fixturePromptCacheRecord.cacheKey);

    expect(storedModel?.loadCount).toBe(1);
    expect(engines.list()).toHaveLength(1);
    expect(downloads.listActive()).toHaveLength(1);
    expect(storedPromptCache?.metadata.source).toBe("test");
    expect(tokens.listActive()).toHaveLength(1);
  });

  it("persists chat and audit records", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const models = new ModelsRepository(testDatabase.database);
    const chat = new ChatRepository(testDatabase.database);

    models.save(fixtureModelArtifact, fixtureModelProfile);
    chat.upsertSession(fixtureChatSession);
    chat.appendMessage(fixtureChatMessage);
    const apiLogId = chat.insertApiLog(fixtureApiLog);

    expect(chat.listSessions()).toHaveLength(1);
    expect(chat.listMessages(fixtureChatSession.id)).toHaveLength(1);
    expect(apiLogId).toBeGreaterThan(0);
    expect(chat.listRecentApiLogs()).toHaveLength(1);
  });

  it("deletes chat sessions and cascades their messages", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const models = new ModelsRepository(testDatabase.database);
    const chat = new ChatRepository(testDatabase.database);

    models.save(fixtureModelArtifact, fixtureModelProfile);
    chat.upsertSession(fixtureChatSession);
    chat.appendMessage(fixtureChatMessage);

    expect(chat.deleteSession(fixtureChatSession.id)).toBe(true);
    expect(chat.listSessions()).toHaveLength(0);
    expect(chat.listMessages(fixtureChatSession.id)).toHaveLength(0);
  });

  it("maps request traces into persisted api logs", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const models = new ModelsRepository(testDatabase.database);
    const chat = new ChatRepository(testDatabase.database);
    models.save(fixtureModelArtifact, fixtureModelProfile);
    const mapped = requestTraceToApiLogRecord(fixtureRequestTrace);
    const id = chat.insertRequestTrace(fixtureRequestTrace);
    const stored = chat.listRecentApiLogs();

    expect(id).toBeGreaterThan(0);
    expect(mapped.endpoint).toBe("/v1/chat/completions");
    expect(mapped.tokensPerSecond).toBe(35);
    expect(stored[0]).toMatchObject({
      traceId: fixtureRequestTrace.traceId,
      endpoint: "/v1/chat/completions",
      promptTokens: fixtureRequestTrace.promptTokens,
      completionTokens: fixtureRequestTrace.completionTokens,
      totalDurationMs: fixtureRequestTrace.durationMs,
      ttftMs: fixtureRequestTrace.ttftMs,
    });
  });

  it("prunes api logs by age", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const chat = new ChatRepository(testDatabase.database);
    chat.insertApiLog({
      endpoint: "/v1/models",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const deleted = pruneApiLogs(testDatabase.database, {
      maxAgeDays: 1,
      now: new Date("2026-03-31T12:00:00.000Z"),
    });

    expect(deleted).toBe(1);
  });

  it("creates isolated deterministic repository fixtures", () => {
    const first = createRepositoryFixtureSet();
    const second = createRepositoryFixtureSet();

    first.modelArtifact.name = "Mutated in one test";
    first.modelProfile.parameterOverrides.temperature = 0.9;

    expect(second.modelArtifact.name).toBe("Qwen 2.5 Coder 7B Instruct");
    expect(second.modelProfile.parameterOverrides.temperature).toBe(0.2);
  });

  it("runs the core runtime retention jobs conservatively", () => {
    const testDatabase = createTestDatabase();
    cleanup = testDatabase.cleanup;

    const fixtures = createRepositoryFixtureSet();
    const models = new ModelsRepository(testDatabase.database);
    const downloads = new DownloadTasksRepository(testDatabase.database);
    const promptCaches = new PromptCachesRepository(testDatabase.database);
    const tokens = new ApiTokensRepository(testDatabase.database);
    const chat = new ChatRepository(testDatabase.database);

    models.save(fixtures.modelArtifact, fixtures.modelProfile);
    promptCaches.upsert(fixtures.promptCacheRecord, { source: "stale" });
    promptCaches.upsert(
      {
        ...fixtures.promptCacheRecord,
        id: "cache_keep",
        cacheKey: "prompt-cache-keep",
        filePath: "/prompt-cache/keep.bin",
        expiresAt: "2026-04-15T12:00:00.000Z",
      },
      { source: "keep" },
    );

    downloads.upsert({
      ...fixtures.downloadTask,
      id: "download_completed_old",
      status: "completed",
      downloadedBytes: fixtures.downloadTask.totalBytes ?? fixtures.downloadTask.downloadedBytes,
      updatedAt: "2026-03-01T12:00:00.000Z",
    });
    downloads.upsert({
      ...fixtures.downloadTask,
      id: "download_failed_old",
      status: "error",
      errorMessage: "checksum mismatch",
      updatedAt: "2026-03-01T12:00:00.000Z",
    });
    downloads.upsert({
      ...fixtures.downloadTask,
      id: "download_keep_active",
      updatedAt: "2026-04-01T11:00:00.000Z",
    });

    tokens.upsert({
      ...fixtures.apiTokenRecord,
      id: "token_revoked_old",
      label: "Revoked",
      tokenHash: "scrypt$16384$8$1$retention-salt$retention-hash-revoked",
      revokedAt: "2026-02-01T12:00:00.000Z",
    });
    tokens.upsert({
      ...fixtures.apiTokenRecord,
      id: "token_keep_active",
      label: "Active",
      tokenHash: "scrypt$16384$8$1$retention-salt$retention-hash-active",
    });

    chat.insertApiLog({
      ...fixtures.apiLog,
      traceId: "trace_old",
      createdAt: "2026-02-01T12:00:00.000Z",
    });
    chat.insertApiLog({
      ...fixtures.apiLog,
      traceId: "trace_keep",
      endpoint: "/v1/models",
      createdAt: "2026-04-01T11:59:00.000Z",
    });

    const result = runCoreRuntimeRetention(testDatabase.database, {
      now: new Date("2026-04-01T12:00:00.000Z"),
      apiLogMaxAgeDays: 30,
      apiLogMaxRows: 10,
      completedDownloadTaskMaxAgeDays: 7,
      failedDownloadTaskMaxAgeDays: 7,
      revokedTokenMaxAgeDays: 30,
    });

    expect(result).toEqual({
      apiLogsDeleted: 1,
      expiredPromptCachesDeleted: 1,
      staleDownloadTasksDeleted: 2,
      revokedApiTokensDeleted: 1,
    });
    expect(downloads.listActive().map((task) => task.id)).toEqual(["download_keep_active"]);
    expect(promptCaches.findByCacheKey("prompt-cache-keep")).toBeDefined();
    expect(promptCaches.findByCacheKey(fixtures.promptCacheRecord.cacheKey)).toBeUndefined();
    expect(tokens.listActive().map((token) => token.id)).toEqual(["token_keep_active"]);
    expect(chat.listRecentApiLogs().map((log) => log.traceId)).toContain("trace_keep");
    expect(chat.listRecentApiLogs().map((log) => log.traceId)).not.toContain("trace_old");
  });
});
