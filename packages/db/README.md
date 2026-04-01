# @localhub/db

Thread 1 Stage 2 freezes the repository, retention, and fixture boundary that Threads 2 and 3 build on.

## Test harness

- `createTestDatabase()` opens a real temporary SQLite database, applies all migrations, and returns a cleanup function.
- `createRepositoryFixtureSet()` returns isolated deep-cloned fixtures so tests can mutate records without leaking state across cases.

## Deterministic fixtures

The fixture set includes stable records for:

- model artifacts and profiles
- engine versions
- download tasks
- prompt caches
- API tokens
- chat sessions and messages
- API logs

## Retention helpers

Use the exported retention helpers for operational cleanup instead of ad hoc deletes:

- `pruneApiLogs()`
- `pruneExpiredPromptCaches()`
- `pruneStaleDownloadTasks()`
- `pruneRevokedApiTokens()`
- `runCoreRuntimeRetention()`

`runCoreRuntimeRetention()` intentionally uses conservative defaults so active downloads, live prompt caches, and unrevoked tokens survive routine cleanup.
