# Switchboard Desktop

Electron wrapper for the Switchboard debug platform.

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
npm install
```

### Run in development

```bash
npm run dev
```

This will compile TypeScript and start Electron loading `http://localhost:8080`.

### Configuration

Set environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:8080` | URL to load in the app |
| `TRUSTED_ORIGINS` | Same as APP_URL origin | Comma-separated list of trusted origins |
| `ALLOW_HTTP_LOCALHOST` | `true` | Allow HTTP for localhost |
| `TRUST_LOCALHOST_WILDCARD` | `true` | Trust any localhost/127.0.0.1 origin (set `false` for strict origin list) |
| `START_IN_TRAY` | `false` | Start minimized to tray |
| `MINIMIZE_TO_TRAY` | `true` | Minimize to tray instead of closing |
| `ENABLE_NOTIFICATIONS` | `true` | Enable native notifications |
| `LOG_LEVEL` | `info` | Logging level |
| `ENABLE_AUTO_UPDATE` | `true` | Enable auto-updates (set `false` for enterprise) |
| `UPDATE_CHANNEL` | `stable` | Auto-update channel (`stable`, `beta`, `alpha`) |
| `UPDATE_CHECK_INTERVAL` | `6` | Hours between update checks (0 to disable periodic) |
| `ENABLE_DEEP_LINKS` | `true` | Enable `switchboard://` deep links |
| `DEEP_LINK_SCHEME` | `switchboard` | Deep link scheme |
| `SPLASH_ENABLED` | `true` | Enable/disable splash screen |

Example:

```bash
APP_URL=https://debug.example.com npm run dev
```

### Splash Screen Configuration

The splash screen can be customized via the config file:

```json
{
  "splash": {
    "enabled": true,
    "logoPath": "./assets/logo.png",
    "logoWidth": 80,
    "backgroundColor": "#1a1a2e",
    "textColor": "#e8e8e8",
    "textColorSecondary": "#a0a0a0",
    "accentColor": "#4f46e5",
    "loadingText": "Connecting...",
    "appName": "Switchboard",
    "showVersion": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable splash screen |
| `customHtmlPath` | - | Path to custom splash HTML (overrides generated) |
| `logoPath` | - | Path to logo image (PNG/SVG) |
| `logoWidth` | `80` | Logo width in pixels |
| `logoHeight` | - | Logo height (auto if not set) |
| `backgroundColor` | `#1a1a2e` | Background color |
| `textColor` | `#e8e8e8` | Primary text color |
| `textColorSecondary` | `#a0a0a0` | Secondary/muted text color |
| `accentColor` | `#4f46e5` | Accent color (spinner, etc.) |
| `loadingText` | `Connecting...` | Loading status text |
| `appName` | `Switchboard` | App name shown on splash |
| `showVersion` | `true` | Show app version on splash |

For full customization, create a custom `splash.html` and set `splash.customHtmlPath`.

Relative splash asset paths (`customHtmlPath`, `logoPath`) are resolved from the
directory of the loaded config file when available.

## Building

### Build macOS package

```bash
npm run package
```

### Run Cross-Phase QA verification

```bash
npm run qa:cross-phase
```

### Build macOS package (x64 only, local default)

```bash
npm run package:mac
```

### Build macOS package (x64 + arm64)

```bash
npm run package:mac:all
```

### Build unpacked directory (debug packaging)

```bash
npm run package:dir
```

## Bridge API

The web app can access desktop features via `window.electronBridge`:

```typescript
// Check if running in Electron
if (window.electronBridge) {
  // Show native notification
  await window.electronBridge.notifications.show('Title', 'Body');

  // Update tray status
  await window.electronBridge.tray.setStatus('connected');

  // Set badge count
  await window.electronBridge.tray.setBadge(5);

  // App controls
  await window.electronBridge.app.minimize();
  await window.electronBridge.app.hide();
  await window.electronBridge.app.show();

  // Get version
  const version = await window.electronBridge.app.getVersion();

  // Storage
  await window.electronBridge.storage.set('key', 'value');
  const value = await window.electronBridge.storage.get('key');
  await window.electronBridge.storage.clear();

  // Secure storage (macOS Keychain via keytar, encrypted fallback if unavailable)
  await window.electronBridge.secureStorage.set('token', 'secret');
  await window.electronBridge.secureStorage.clear();

  // Diagnostics
  await window.electronBridge.diagnostics.copyToClipboard();
  const exportPath = await window.electronBridge.diagnostics.exportToFile();
  console.log('Diagnostics exported to:', exportPath);

  // Auto-updates
  const updateStatus = await window.electronBridge.updates.getStatus();
  // status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  console.log('Update status:', updateStatus.status);

  // Manually check for updates
  await window.electronBridge.updates.checkNow();

  // Listen for update status changes
  const unsubscribe = window.electronBridge.updates.onStatusChange((info) => {
    console.log('Update:', info.status, info.version, info.progress);
  });

  // Install downloaded update (restarts app)
  if (updateStatus.status === 'downloaded') {
    await window.electronBridge.updates.installNow();
  }
}
```

## Security

- `contextIsolation`: enabled
- `sandbox`: enabled
- `nodeIntegration`: disabled
- Navigation restricted to trusted origins
- IPC calls validated for origin and payload
- Secure storage uses OS keychain via `keytar` when available, with encrypted
  fallback storage via Electron `safeStorage`
- Structured diagnostics logs are redacted and can be copied/exported via bridge APIs

## License

MIT
