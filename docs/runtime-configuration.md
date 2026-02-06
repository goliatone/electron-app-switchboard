# Runtime Configuration Reference

This document is the runtime configuration reference for Switchboard Desktop (D1).

## Configuration Sources and Precedence

Configuration is loaded in this order (highest wins):

1. Environment variables
2. Config file (`switchboard.config.json` or `config.json`)
3. Built-in defaults

Implementation: `src/shared/config.ts`.

## Runtime Variables

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `APP_URL` | URL string | `http://localhost:8080` | Remote SSR app loaded by Electron (`BrowserWindow.loadURL`) |
| `TRUSTED_ORIGINS` | CSV string | origin of `APP_URL` | Allowlist for renderer navigation + IPC sender validation |
| `ALLOW_HTTP_LOCALHOST` | boolean | `true` | Allows localhost HTTP origins in dev policy checks |
| `TRUST_LOCALHOST_WILDCARD` | boolean | `true` | Trust any localhost/127.0.0.1 port when localhost HTTP is allowed |
| `START_IN_TRAY` | boolean | `false` | Start hidden with tray-only access |
| `MINIMIZE_TO_TRAY` | boolean | `true` | Intercept close and hide to tray |
| `ENABLE_NOTIFICATIONS` | boolean | `true` | Enable native notification APIs |
| `LOG_LEVEL` | `debug|info|warn|error` | `info` | Diagnostics logging threshold |
| `ENABLE_AUTO_UPDATE` | boolean | `true` | Enable `electron-updater` runtime behavior |
| `UPDATE_CHANNEL` | `stable|beta|alpha` | `stable` | Update channel for updater checks |
| `UPDATE_CHECK_INTERVAL` | number (hours) | `6` | Periodic update check interval (`0` disables periodic checks) |
| `ENABLE_DEEP_LINKS` | boolean | `true` | Enables app protocol handling |
| `DEEP_LINK_SCHEME` | string | `switchboard` | Protocol scheme (`switchboard://...`) |
| `SWITCHBOARD_CONFIG` | file path | unset | Optional explicit config file path |

## Config File Schema

Config file keys map 1:1 to `ConfigFile` fields:

- `appUrl`
- `trustedOrigins`
- `allowHttpLocalhost`
- `trustLocalhostWildcard`
- `startInTray`
- `minimizeToTray`
- `enableNotifications`
- `logLevel`
- `enableAutoUpdate`
- `updateChannel`
- `updateCheckInterval`
- `enableDeepLinks`
- `deepLinkScheme`

Example file: `switchboard.config.example.json`.

## Config File Discovery

If `SWITCHBOARD_CONFIG` is unset, files are searched in this order:

1. `<cwd>/switchboard.config.json`
2. `<cwd>/config.json`
3. App directory (packaged executable directory), same names
4. `app.getPath("userData")`, same names
5. `~/.switchboard.config.json`
6. `~/.config/switchboard/config.json`

## Trusted Origin Policy

`isTrustedOrigin(url, config)` allows:

1. Exact origin match in `trustedOrigins`, or
2. If `ALLOW_HTTP_LOCALHOST=true` and `TRUST_LOCALHOST_WILDCARD=true`:
   any `localhost` or `127.0.0.1` host origin.

Notes:

- Invalid `APP_URL` falls back to `http://localhost:8080`.
- If `TRUSTED_ORIGINS` is omitted, it defaults to `[new URL(APP_URL).origin]`.
- Use strict `TRUSTED_ORIGINS` and disable wildcard localhost in production.

## Recommended Environment Profiles

Development:

```bash
APP_URL=http://localhost:8080
TRUSTED_ORIGINS=http://localhost:8080
ALLOW_HTTP_LOCALHOST=true
TRUST_LOCALHOST_WILDCARD=true
ENABLE_AUTO_UPDATE=false
```

Staging:

```bash
APP_URL=https://debug-staging.example.com
TRUSTED_ORIGINS=https://debug-staging.example.com
ALLOW_HTTP_LOCALHOST=false
TRUST_LOCALHOST_WILDCARD=false
UPDATE_CHANNEL=beta
```

Production:

```bash
APP_URL=https://debug.example.com
TRUSTED_ORIGINS=https://debug.example.com
ALLOW_HTTP_LOCALHOST=false
TRUST_LOCALHOST_WILDCARD=false
UPDATE_CHANNEL=stable
```

