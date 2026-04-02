import path from "node:path";

import { createDatabaseBackup } from "../migration-safety.js";
import { runMigrations } from "../migrations.js";
import { closeDatabase, openDatabase } from "../sqlite.js";

const migrationsDir = path.resolve(import.meta.dirname, "../../migrations");
const args = process.argv.slice(2);
const shouldPrintPlan = args.includes("--plan");
const shouldCreateBackup = args.includes("--backup");
const filePath =
  args.find((value) => !value.startsWith("--")) ??
  process.env.LOCAL_LLM_HUB_DATABASE_FILE ??
  path.resolve(".local/local-llm-hub/dev/data/gateway.sqlite");

const { database, safetyPlan } = openDatabase({
  filePath,
  migrationsDir,
  migrate: false,
});

if (shouldPrintPlan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        filePath,
        currentVersion: safetyPlan.currentVersion,
        targetVersion: safetyPlan.targetVersion,
        pendingCount: safetyPlan.pendingCount,
        backupRecommended: safetyPlan.backupRecommended,
        pendingMigrations: safetyPlan.pendingMigrations.map((migration) => migration.fileName),
      },
      null,
      2,
    )}\n`,
  );
  closeDatabase(database);
  process.exit(0);
}

if (shouldCreateBackup && safetyPlan.backupRecommended && safetyPlan.backupPath) {
  createDatabaseBackup(filePath, safetyPlan.backupPath);
  process.stdout.write(`backup ${safetyPlan.backupPath}\n`);
}

const migrations = shouldPrintPlan
  ? { applied: [], skipped: [] }
  : runMigrations(database, migrationsDir);

for (const migration of migrations.applied) {
  process.stdout.write(`applied ${migration.fileName}\n`);
}

if (migrations.applied.length === 0) {
  process.stdout.write("no migrations applied\n");
}

closeDatabase(database);
