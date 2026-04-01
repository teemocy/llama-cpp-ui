# Config Precedence and Override Rules

Thread 1 Stage 2 freezes configuration resolution and runtime override behavior across the desktop shell, gateway process, and engine/runtime packages.

## Shared config merge order

All shared config loaders resolve values in this order:

1. package defaults
2. JSON config file values
3. environment overrides

This applies to both `loadGatewayConfig()` and `loadDesktopConfig()` in `@localhub/platform`.

## Config file location precedence

- Gateway config file: `LOCAL_LLM_HUB_GATEWAY_CONFIG_FILE` or the resolved app-support `config/gateway.json`
- Desktop config file: `LOCAL_LLM_HUB_DESKTOP_CONFIG_FILE` or the resolved app-support `config/desktop.json`
- App support root: `LOCAL_LLM_HUB_APP_SUPPORT_DIR` overrides the environment-derived support path for development, test, and packaged runs

## Gateway environment overrides

The shared gateway loader owns these environment variables:

- `LOCAL_LLM_HUB_ENV`
- `LOCAL_LLM_HUB_GATEWAY_PUBLIC_HOST`
- `LOCAL_LLM_HUB_GATEWAY_PUBLIC_PORT`
- `LOCAL_LLM_HUB_GATEWAY_CONTROL_HOST`
- `LOCAL_LLM_HUB_GATEWAY_CONTROL_PORT`
- `LOCAL_LLM_HUB_ENABLE_LAN`
- `LOCAL_LLM_HUB_AUTH_REQUIRED`
- `LOCAL_LLM_HUB_LOG_LEVEL`
- `LOCAL_LLM_HUB_DEFAULT_MODEL_TTL_MS`
- `LOCAL_LLM_HUB_REQUEST_TRACE_RETENTION_DAYS`

The gateway service layers on auth and telemetry overrides with this precedence:

1. `LOCAL_LLM_HUB_GATEWAY_PUBLIC_BEARER_TOKEN`
2. legacy fallback `GATEWAY_PUBLIC_BEARER_TOKEN`
3. shared fallback `LOCAL_LLM_HUB_AUTH_TOKEN`

Control-token precedence is:

1. `LOCAL_LLM_HUB_GATEWAY_CONTROL_BEARER_TOKEN`
2. legacy fallback `GATEWAY_CONTROL_BEARER_TOKEN`
3. resolved public bearer token
4. shared fallback `LOCAL_LLM_HUB_AUTH_TOKEN`

If `LOCAL_LLM_HUB_AUTH_REQUIRED=true`, the public bearer token must resolve to a non-empty value or startup must fail closed.

## Desktop environment overrides

The shared desktop loader owns these environment variables:

- `LOCAL_LLM_HUB_ENV`
- `LOCAL_LLM_HUB_CLOSE_TO_TRAY`
- `LOCAL_LLM_HUB_AUTO_LAUNCH_GATEWAY`
- `LOCAL_LLM_HUB_THEME`
- `LOCAL_LLM_HUB_DESKTOP_WIDTH`
- `LOCAL_LLM_HUB_DESKTOP_HEIGHT`
- `LOCAL_LLM_HUB_LOG_LEVEL`

## Runtime override precedence

Runtime parameter resolution stays fixed at:

1. engine defaults
2. GGUF metadata
3. saved model profile overrides
4. explicitly allowed per-request overrides

Threads should not add new persisted override keys or new per-request override fields without Thread 1 review, because those changes affect shared config, persistence, and UI expectations together.
