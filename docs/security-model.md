# Security Model and Boundaries

This document summarizes Switchboard Desktop security boundaries (D3).

Primary sources:

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/shared/config.ts`
- `src/main/diagnostics.ts`

## Trust Boundaries

1. Main process (`src/main`) is privileged and trusted.
2. Preload (`src/preload`) is trusted, but intentionally narrow.
3. Renderer content (`APP_URL`) is untrusted by default and only allowed through strict origin policy.
4. External websites and deep-link sources are untrusted input.

## Renderer Hardening

`BrowserWindow.webPreferences` security flags:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- `webviewTag: false`
- `plugins: false`
- `experimentalFeatures: false`

No Node primitives are exposed directly to renderer pages. All privileged actions go through preload bridge methods.

## Navigation and Popup Controls

Controls on `will-navigate` and `setWindowOpenHandler`:

- Deep links (`<scheme>://`) are intercepted and handled in main process.
- Non-trusted origins are blocked in-app and opened externally with `shell.openExternal`.
- Trusted popup URLs are still routed to external browser to keep single-window model.
- `will-attach-webview` is always blocked.
- Global `web-contents-created` handler blocks all `file://` navigation.

## IPC Security

Every `ipcMain.handle(...)` validates sender origin:

1. Sender URL must be present.
2. URL origin must pass `isTrustedOrigin(url, config)`.
3. Exception: fallback page data URL is allowed only when:
   - fallback page is active,
   - sender URL starts with `data:text/html`,
   - sender is `mainWindow.webContents`.

Payload validation is enforced per channel (type checks, enum checks, size limits, key format checks).

## Runtime Origin Policy

Defined in `src/shared/config.ts`:

- `TRUSTED_ORIGINS` explicit allowlist is primary policy.
- Optional localhost wildcard trust exists only when both:
  - `ALLOW_HTTP_LOCALHOST=true`
  - `TRUST_LOCALHOST_WILDCARD=true`

Production recommendation:

- Explicit HTTPS `APP_URL`
- Exact `TRUSTED_ORIGINS`
- localhost wildcard disabled

## Storage Security

Non-sensitive storage:

- `electron-store` file (`switchboard-store`)
- Keys namespaced to `switchboard.local.*`

Sensitive storage:

1. Preferred backend: OS keychain via `keytar` (when available)
2. Fallback backend: `safeStorage` encrypted value in local store (`switchboard-secure-fallback`)

Additional controls:

- Secure key index tracking for clear operations
- Namespaced key migration from legacy keys
- Key redaction in logs

## Diagnostics and Secret Redaction

Diagnostics are JSONL entries with redaction:

- Sensitive keys (token/password/secret/cookie/authorization variants) are replaced with `[REDACTED]`.
- Sensitive token-like patterns in free text are redacted.
- Error messages and metadata are passed through redaction.

Exports and clipboard copies use redacted log content.

## Deep Link Security

Allowed deep-link actions only:

- `open`, `show`, `reload`, `settings`, `quit`
- `route/<path>?query#hash` with app-relative path constraint

Anything malformed or not in this allowlist is ignored and logged as invalid.

## Explicit Non-Goals

- Running arbitrary local files in renderer.
- Allowing unvalidated IPC from web content.
- In-app rendering of arbitrary popup windows.
- Plaintext storage of secure values.

