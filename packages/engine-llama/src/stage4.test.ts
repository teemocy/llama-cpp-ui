import { chmod, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EngineVersionsRepository,
  ModelsRepository,
  PromptCachesRepository,
  createTestDatabase,
} from "@localhub/db";
import { afterEach, describe, expect, it } from "vitest";

import { createLlamaCppAdapter } from "./index.js";
import { LlamaCppModelManager } from "./model-manager.js";

const tempDirs: string[] = [];
const cleanups: Array<() => void> = [];

enum TestGgufValueType {
  Uint32 = 4,
  String = 8,
  Uint64 = 10,
}

function uint32Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function uint64Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function stringBuffer(value: string): Buffer {
  const utf8 = Buffer.from(value, "utf8");
  return Buffer.concat([uint64Buffer(utf8.length), utf8]);
}

function createMetadataEntry(
  key: string,
  valueType: TestGgufValueType,
  value: string | number,
): Buffer {
  const valueBuffer =
    valueType === TestGgufValueType.String
      ? stringBuffer(String(value))
      : valueType === TestGgufValueType.Uint32
        ? uint32Buffer(Number(value))
        : uint64Buffer(Number(value));

  return Buffer.concat([stringBuffer(key), uint32Buffer(valueType), valueBuffer]);
}

async function createSupportRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "localhub-engine-stage4-"));
  tempDirs.push(directory);
  return directory;
}

async function writeSampleGgufFile(targetPath: string, modelName = "Stage4 Tiny Chat"): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });

  const entries = [
    createMetadataEntry("general.name", TestGgufValueType.String, modelName),
    createMetadataEntry("general.architecture", TestGgufValueType.String, "llama"),
    createMetadataEntry("general.quantization", TestGgufValueType.String, "Q4_K_M"),
    createMetadataEntry("llama.context_length", TestGgufValueType.Uint32, 65536),
    createMetadataEntry("general.parameter_count", TestGgufValueType.Uint64, 123456789),
    createMetadataEntry("tokenizer.ggml.model", TestGgufValueType.String, "gpt2"),
    createMetadataEntry("tokenizer.chat_template", TestGgufValueType.String, "<s>{{prompt}}</s>"),
  ];

  const payload = Buffer.concat([
    Buffer.from("GGUF", "ascii"),
    uint32Buffer(3),
    uint64Buffer(0),
    uint64Buffer(entries.length),
    ...entries,
  ]);

  await writeFile(targetPath, payload);
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("llama.cpp stage 4 hardening", () => {
  it("activates an installed engine version and repairs a missing binary", async () => {
    const supportRoot = await createSupportRoot();
    const fakeBinDir = path.join(supportRoot, "fake-bin");
    const fakeBinaryPath = path.join(fakeBinDir, "llama-server");
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeBinaryPath, "#!/bin/sh\nexit 0\n");
    await chmod(fakeBinaryPath, 0o755);

    const testDatabase = createTestDatabase();
    cleanups.push(testDatabase.cleanup);

    const manager = new LlamaCppModelManager({
      supportRoot,
      localModelsDir: path.join(supportRoot, "models"),
      adapter: createLlamaCppAdapter({
        supportRoot,
        env: {
          ...process.env,
          PATH: fakeBinDir,
        },
      }),
      modelsRepository: new ModelsRepository(testDatabase.database),
      engineVersionsRepository: new EngineVersionsRepository(testDatabase.database),
      promptCachesRepository: new PromptCachesRepository(testDatabase.database),
    });

    await manager.ensureEngineVersion("stage4-binary");
    const activated = await manager.activateEngineVersion("stage4-binary");
    expect(activated.activated).toBe(true);
    expect(manager.listEngineVersions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionTag: "stage4-binary",
          isActive: true,
          binaryPath: fakeBinaryPath,
        }),
      ]),
    );

    await unlink(fakeBinaryPath);
    await writeFile(fakeBinaryPath, "#!/bin/sh\nexit 0\n");
    await chmod(fakeBinaryPath, 0o755);

    const repaired = await manager.repairIntegrity();
    expect(repaired.notes.join(" ")).not.toContain("missing");
    expect(manager.listEngineVersions()[0]?.binaryPath).toBe(fakeBinaryPath);
  });

  it("estimates memory risk and manages prompt-cache lifecycle metadata", async () => {
    const supportRoot = await createSupportRoot();
    const artifactPath = path.join(supportRoot, "models", "stage4-tiny-chat.gguf");
    const promptCachePath = path.join(supportRoot, "prompt-caches", "stage4-cache.bin");
    await writeSampleGgufFile(artifactPath);
    await mkdir(path.dirname(promptCachePath), { recursive: true });
    await writeFile(promptCachePath, Buffer.alloc(256));

    const testDatabase = createTestDatabase();
    cleanups.push(testDatabase.cleanup);

    const modelsRepository = new ModelsRepository(testDatabase.database);
    const promptCachesRepository = new PromptCachesRepository(testDatabase.database);
    const manager = new LlamaCppModelManager({
      supportRoot,
      localModelsDir: path.join(supportRoot, "models"),
      adapter: createLlamaCppAdapter({
        supportRoot,
        preferFakeWorker: true,
      }),
      modelsRepository,
      engineVersionsRepository: new EngineVersionsRepository(testDatabase.database),
      promptCachesRepository,
    });

    const registered = await manager.registerLocalModel({
      filePath: artifactPath,
      promptCacheKey: "stage4-cache",
    });

    const estimate = manager.estimateLoadResources(registered.artifact.id);
    expect(estimate.estimatedWorkingSetBytes).toBeGreaterThan(estimate.estimatedModelBytes);
    expect(estimate.warnings).toEqual(
      expect.arrayContaining(["Large context lengths increase KV cache memory pressure."]),
    );

    const recorded = manager.recordPromptCacheAccess(registered.artifact.id);
    expect(recorded?.cacheKey).toBe("stage4-cache");
    expect(promptCachesRepository.findByCacheKey("stage4-cache")?.sizeBytes).toBe(256);

    await unlink(promptCachePath);
    const cleanupSummary = manager.cleanupPromptCaches("2026-04-02T12:00:00.000Z");
    expect(cleanupSummary.removedCacheKeys).toContain("stage4-cache");
    expect(promptCachesRepository.findByCacheKey("stage4-cache")).toBeUndefined();
  });
});
