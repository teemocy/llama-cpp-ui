import type { DatabaseSync } from "node:sqlite";

export interface ApiLogRetentionPolicy {
  maxAgeDays?: number;
  maxRows?: number;
  now?: Date;
}

export function pruneApiLogs(
  database: DatabaseSync,
  { maxAgeDays = 30, maxRows = 100000, now = new Date() }: ApiLogRetentionPolicy = {},
): number {
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  let deleted = Number(
    (
      database.prepare("DELETE FROM api_logs WHERE created_at < ?").run(cutoff) as {
        changes?: number | bigint;
      }
    ).changes ?? 0,
  );

  const countRow = database.prepare("SELECT COUNT(*) AS count FROM api_logs").get() as {
    count: number;
  };
  const overflow = Math.max(0, countRow.count - maxRows);

  if (overflow > 0) {
    deleted += Number(
      (
        database
          .prepare(
            `
              DELETE FROM api_logs
              WHERE id IN (
                SELECT id
                FROM api_logs
                ORDER BY created_at ASC
                LIMIT ?
              )
            `,
          )
          .run(overflow) as { changes?: number | bigint }
      ).changes ?? 0,
    );
  }

  return deleted;
}

export function pruneExpiredPromptCaches(database: DatabaseSync, now = new Date()): number {
  return Number(
    (
      database
        .prepare(
          `
            DELETE FROM prompt_caches
            WHERE expires_at IS NOT NULL
              AND expires_at <= ?
          `,
        )
        .run(now.toISOString()) as { changes?: number | bigint }
    ).changes ?? 0,
  );
}

export interface DownloadTaskRetentionPolicy {
  completedMaxAgeDays?: number;
  failedMaxAgeDays?: number;
  now?: Date;
}

export function pruneStaleDownloadTasks(
  database: DatabaseSync,
  {
    completedMaxAgeDays = 7,
    failedMaxAgeDays = 30,
    now = new Date(),
  }: DownloadTaskRetentionPolicy = {},
): number {
  const completedCutoff = new Date(
    now.getTime() - completedMaxAgeDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const failedCutoff = new Date(
    now.getTime() - failedMaxAgeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  return Number(
    (
      database
        .prepare(
          `
            DELETE FROM download_tasks
            WHERE (status = 'completed' AND updated_at <= ?)
               OR (status = 'error' AND updated_at <= ?)
          `,
        )
        .run(completedCutoff, failedCutoff) as { changes?: number | bigint }
    ).changes ?? 0,
  );
}

export interface ApiTokenRetentionPolicy {
  revokedMaxAgeDays?: number;
  now?: Date;
}

export function pruneRevokedApiTokens(
  database: DatabaseSync,
  { revokedMaxAgeDays = 90, now = new Date() }: ApiTokenRetentionPolicy = {},
): number {
  const cutoff = new Date(now.getTime() - revokedMaxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  return Number(
    (
      database
        .prepare(
          `
            DELETE FROM api_tokens
            WHERE revoked_at IS NOT NULL
              AND revoked_at <= ?
          `,
        )
        .run(cutoff) as { changes?: number | bigint }
    ).changes ?? 0,
  );
}

export interface CoreRuntimeRetentionPolicy {
  now?: Date;
  apiLogMaxAgeDays?: number;
  apiLogMaxRows?: number;
  completedDownloadTaskMaxAgeDays?: number;
  failedDownloadTaskMaxAgeDays?: number;
  revokedTokenMaxAgeDays?: number;
}

export interface CoreRuntimeRetentionResult {
  apiLogsDeleted: number;
  expiredPromptCachesDeleted: number;
  staleDownloadTasksDeleted: number;
  revokedApiTokensDeleted: number;
}

export function runCoreRuntimeRetention(
  database: DatabaseSync,
  policy: CoreRuntimeRetentionPolicy = {},
): CoreRuntimeRetentionResult {
  const now = policy.now ?? new Date();
  const apiLogPolicy: ApiLogRetentionPolicy = {
    now,
    ...(policy.apiLogMaxAgeDays !== undefined ? { maxAgeDays: policy.apiLogMaxAgeDays } : {}),
    ...(policy.apiLogMaxRows !== undefined ? { maxRows: policy.apiLogMaxRows } : {}),
  };
  const downloadTaskPolicy: DownloadTaskRetentionPolicy = {
    now,
    ...(policy.completedDownloadTaskMaxAgeDays !== undefined
      ? { completedMaxAgeDays: policy.completedDownloadTaskMaxAgeDays }
      : {}),
    ...(policy.failedDownloadTaskMaxAgeDays !== undefined
      ? { failedMaxAgeDays: policy.failedDownloadTaskMaxAgeDays }
      : {}),
  };
  const apiTokenPolicy: ApiTokenRetentionPolicy = {
    now,
    ...(policy.revokedTokenMaxAgeDays !== undefined
      ? { revokedMaxAgeDays: policy.revokedTokenMaxAgeDays }
      : {}),
  };

  return {
    apiLogsDeleted: pruneApiLogs(database, apiLogPolicy),
    expiredPromptCachesDeleted: pruneExpiredPromptCaches(database, now),
    staleDownloadTasksDeleted: pruneStaleDownloadTasks(database, downloadTaskPolicy),
    revokedApiTokensDeleted: pruneRevokedApiTokens(database, apiTokenPolicy),
  };
}
