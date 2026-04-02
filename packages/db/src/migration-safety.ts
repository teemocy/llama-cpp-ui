import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type DatabaseSync as DatabaseHandle } from "node:sqlite";

import {
  type AppliedMigration,
  type MigrationDefinition,
  listAppliedMigrations,
  loadMigrations,
} from "./migrations.js";

export interface MigrationSafetyPlan {
  databaseFilePath: string;
  isNewDatabase: boolean;
  currentVersion: number;
  targetVersion: number;
  appliedCount: number;
  pendingCount: number;
  pendingMigrations: Array<Pick<MigrationDefinition, "version" | "fileName" | "checksum">>;
  backupRecommended: boolean;
  backupPath?: string;
}

export interface CreateMigrationSafetyPlanOptions {
  databaseFilePath: string;
  migrationsDir: string;
  appliedMigrations?: AppliedMigration[];
  migrationDefinitions?: MigrationDefinition[];
  databaseFileExists?: boolean;
}

function resolveCurrentVersion(appliedMigrations: AppliedMigration[]): number {
  return appliedMigrations.at(-1)?.version ?? 0;
}

function createBackupFilePath(databaseFilePath: string): string {
  return `${databaseFilePath}.${new Date().toISOString().replace(/[:]/g, "-")}.bak`;
}

export function createMigrationSafetyPlan(
  options: CreateMigrationSafetyPlanOptions,
): MigrationSafetyPlan {
  const appliedMigrations = options.appliedMigrations ?? [];
  const migrationDefinitions =
    options.migrationDefinitions ?? loadMigrations(options.migrationsDir);
  const currentVersion = resolveCurrentVersion(appliedMigrations);
  const targetVersion = migrationDefinitions.at(-1)?.version ?? currentVersion;
  const pendingMigrations = migrationDefinitions
    .filter((migration) => migration.version > currentVersion)
    .map((migration) => ({
      version: migration.version,
      fileName: migration.fileName,
      checksum: migration.checksum,
    }));
  const databaseFileExists = options.databaseFileExists ?? existsSync(options.databaseFilePath);
  const isNewDatabase = !databaseFileExists;

  return {
    databaseFilePath: options.databaseFilePath,
    isNewDatabase,
    currentVersion,
    targetVersion,
    appliedCount: appliedMigrations.length,
    pendingCount: pendingMigrations.length,
    pendingMigrations,
    backupRecommended: !isNewDatabase && pendingMigrations.length > 0,
    ...(!isNewDatabase && pendingMigrations.length > 0
      ? { backupPath: createBackupFilePath(options.databaseFilePath) }
      : {}),
  };
}

export function planDatabaseMigrationSafety(
  database: DatabaseHandle,
  databaseFilePath: string,
  migrationsDir: string,
): MigrationSafetyPlan {
  return createMigrationSafetyPlan({
    databaseFilePath,
    migrationsDir,
    appliedMigrations: listAppliedMigrations(database),
    migrationDefinitions: loadMigrations(migrationsDir),
  });
}

function escapeSqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function createDatabaseBackup(sourceFilePath: string, backupFilePath: string): string {
  if (sourceFilePath === ":memory:") {
    throw new Error("Cannot create a filesystem backup for an in-memory SQLite database.");
  }

  mkdirSync(path.dirname(backupFilePath), { recursive: true });
  rmSync(backupFilePath, { force: true });

  const database = new DatabaseSync(sourceFilePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec(`VACUUM INTO ${escapeSqliteStringLiteral(backupFilePath)};`);
  } finally {
    database.close();
  }

  return backupFilePath;
}
