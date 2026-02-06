# Connectivity Fallback UX and Deep-Link Behavior

This document captures fallback UX and deep-link handling notes (D5).

Primary sources:

- `src/main/index.ts`
- `src/shared/deeplink.ts`
- `src/shared/deeplink.test.ts`

## Connectivity Fallback UX

Fallback mode is activated when the configured remote app cannot be loaded.

Triggers:

- Initial `loadURL(APP_URL)` failure
- `did-fail-load` for `APP_URL` (or matching prefix)
- Reload/settings route failures initiated from deep links or tray actions

Behavior in fallback mode:

- Main window loads a local `data:text/html` fallback page.
- Tray status is set to `disconnected`.
- Page shows:
  - Error title/message
  - Target `APP_URL`
  - Actions: `Retry Connection`, `Settings`, `Quit`

Fallback actions:

- `Retry Connection` -> `window.location.replace(APP_URL)`
- `Settings` -> `window.location.replace(new URL('/settings', APP_URL))`
- `Quit` -> `window.electronBridge.app.quit()` (if available)

When remote app later loads successfully (`did-finish-load`):

- fallback flag is cleared
- tray status becomes `connected`

## Tray Interaction in Degraded States

- `Reload` tray action tries to reload `APP_URL` and re-enters fallback on failure.
- Updater events can set tray status to `degraded` (update available/error).
- Fallback connectivity failure sets `disconnected`.

## Deep Link Protocol

Protocol registration:

- App attempts `app.setAsDefaultProtocolClient(config.deepLinkScheme)` when deep links are enabled.
- Default scheme is `switchboard`.

Inbound paths:

- `open-url` event (macOS)
- process argv parsing (`extractDeepLinkFromArgv`) for startup/second-instance flows

Pre-ready deep links are queued and replayed after `app.whenReady()`.

## Supported Deep-Link Grammar

Actions:

- `switchboard://open`
- `switchboard://show`
- `switchboard://reload`
- `switchboard://settings`
- `switchboard://quit`

Route:

- `switchboard://route/<path>?query#hash`

Validation (`parseDeepLink`):

- Scheme must match configured scheme.
- Action hostname must be in allowlist.
- Route path is constrained to app-relative path beginning with `/`.
- Unknown or malformed links return `null` and are ignored.

## Deep-Link Routing Semantics

Accepted action handling:

- `quit`: sets quitting flag and exits app.
- `reload`: loads `APP_URL` (fallback on failure).
- `settings`: loads `new URL('/settings', APP_URL)` (fallback on failure).
- `open`/`show`: shows and focuses main window.

Accepted route handling:

- Builds target URL with `new URL(parsed.path, APP_URL)`.
- Loads target URL in main window.
- Shows/focuses window.
- Falls back if route load fails.

Rejected behavior:

- If deep links disabled via config: ignore and log warning.
- If parse fails: ignore and log warning.

## Security Notes

- Deep links are handled in main process only.
- Link parsing enforces allowlist and route constraints.
- No arbitrary command execution from protocol URLs.
- Navigation still passes normal trusted-origin controls.

## Test Coverage

`src/shared/deeplink.test.ts` covers:

- valid action parsing
- valid route parsing
- unknown scheme/action rejection
- argv extraction behavior

