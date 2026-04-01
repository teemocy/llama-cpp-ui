# Shared Contracts

Thread 3 Stage 0 freezes the engine and artifact contracts in this package so runtime and UI layers can build against stable metadata before real process management exists. Thread 1 Stage 2 extends that freeze with runtime, persistence, and gateway-event fixtures used by downstream threads.

Exports:
- engine adapter types
- capability shapes
- GGUF and model artifact types
- provider search/download contract types
- local artifact layout specification

Sample payloads for contract tests live in `./fixtures`.

Stage 2 fixture snapshots:
- `foundation-model-artifact.sample.json`
- `foundation-model-profile.sample.json`
- `foundation-runtime-key.sample.json`
- `foundation-worker-state.sample.json`
- `foundation-download-task.sample.json`
- `foundation-gateway-event.sample.json`
