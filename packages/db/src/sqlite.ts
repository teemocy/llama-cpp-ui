import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type MigrationSafetyPlan, createMigrationSafetyPlan } from "./migration-safety.js";
import { listAppliedMigrations } from "./migrations.js";
import { type MigrationRunResult, loadMigrations, runMigrations } from "./migrations.js";

export interface OpenDatabaseOptions {
  filePath: string;
  migrationsDir: string;
  migrate?: boolean;
}

export interface OpenDatabaseResult {
  database: DatabaseSync;
  migrations: MigrationRunResult;
  safetyPlan: MigrationSafetyPlan;
}

function ensureParentDirectory(filePath: string): void {
  if (filePath === ":memory:") {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
}

function applyPragmas(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
}

export function openDatabase(options: OpenDatabaseOptions): OpenDatabaseResult {
  ensureParentDirectory(options.filePath);
  const databaseFileExists = options.filePath === ":memory:" ? false : existsSync(options.filePath);
  const database = new DatabaseSync(options.filePath);
  applyPragmas(database);
  const migrationDefinitions = loadMigrations(options.migrationsDir);
  const safetyPlan = createMigrationSafetyPlan({
    databaseFilePath: options.filePath,
    migrationsDir: options.migrationsDir,
    appliedMigrations: listAppliedMigrations(database),
    migrationDefinitions,
    databaseFileExists,
  });

  const migrations =
    options.migrate === false
      ? { applied: [], skipped: [] }
      : runMigrations(database, options.migrationsDir, migrationDefinitions);

  return { database, migrations, safetyPlan };
}

export function closeDatabase(database: DatabaseSync): void {
  database.close();
}
