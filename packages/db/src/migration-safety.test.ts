import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDatabaseBackup,
  createMigrationSafetyPlan,
  listAppliedMigrations,
  openDatabase,
} from "./index.js";

const tempDirs: string[] = [];
const migrationsDir = path.resolve(import.meta.dirname, "../migrations");

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("migration safety", () => {
  it("plans backups for existing databases with pending migrations", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "localhub-migration-plan-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "gateway.sqlite");

    const { database } = openDatabase({
      filePath,
      migrationsDir,
    });

    database.exec("DELETE FROM schema_migrations WHERE version = 3");
    const applied = listAppliedMigrations(database);
    const plan = createMigrationSafetyPlan({
      databaseFilePath: filePath,
      migrationsDir,
      appliedMigrations: applied,
    });

    expect(plan.isNewDatabase).toBe(false);
    expect(plan.currentVersion).toBe(2);
    expect(plan.targetVersion).toBe(3);
    expect(plan.pendingCount).toBe(1);
    expect(plan.backupRecommended).toBe(true);
    expect(plan.backupPath).toContain(".bak");
    database.close();
  });

  it("creates a WAL-safe backup that preserves committed rows", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "localhub-migration-backup-"));
    tempDirs.push(tempDir);
    const sourceFilePath = path.join(tempDir, "gateway.sqlite");
    const backupFilePath = path.join(tempDir, "backups", "gateway.sqlite.bak");
    const { database } = openDatabase({
      filePath: sourceFilePath,
      migrationsDir,
    });

    database.exec(`
      CREATE TABLE IF NOT EXISTS backup_test (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    database.exec("INSERT INTO backup_test (value) VALUES ('wal-safe');");

    expect(existsSync(`${sourceFilePath}-wal`)).toBe(true);

    const createdPath = createDatabaseBackup(sourceFilePath, backupFilePath);
    const { database: backupDatabase } = openDatabase({
      filePath: backupFilePath,
      migrationsDir,
      migrate: false,
    });

    expect(createdPath).toBe(backupFilePath);
    expect(
      backupDatabase.prepare("SELECT value FROM backup_test ORDER BY id DESC LIMIT 1").get(),
    ).toEqual({
      value: "wal-safe",
    });

    backupDatabase.close();
    database.close();
  });
});
