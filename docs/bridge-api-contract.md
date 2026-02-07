# Bridge API Contract

This document defines the renderer contract for `window.electronBridge` (D2).

Primary sources:

- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/main/index.ts` (`ipcMain.handle` implementations)

## Contract Surface

`window.electronBridge` is exposed by preload with `contextBridge.exposeInMainWorld`.

Top-level shape:

- `isElectron: true`
- `notifications`
- `tray`
- `app`
- `storage`
- `secureStorage`
- `diagnostics`
- `updates`

All callable APIs are asynchronous and return `Promise<...>`, except `updates.onStatusChange`, which returns an unsubscribe function.

## Method Reference

### `notifications`

- `show(title: string, body: string, options?: NotificationOptions): Promise<void>`
- `requestPermission(): Promise<boolean>`

Validation:

- `title`/`body` must be strings.
- Main process limits: title `1..256` chars, body `0..2048` chars.
- Unsupported platform or disabled notifications are rejected/gracefully no-op based on method.

### `tray`

- `setStatus(status: 'connected' | 'degraded' | 'disconnected'): Promise<void>`
- `setBadge(count: number): Promise<void>`
- `setInfo(info: TrayInfo): Promise<void>`
- `getInfo(): Promise<TrayInfo & { uptime: number }>`

Validation:

- `status` must be one of the three enum values.
- `count` must be finite and non-negative.
- `setInfo.status` must be one of the three tray status values.
- `setInfo.connectedApps` (if provided) must be an array of `{ id: string, name: string, status: 'healthy' | 'warning' | 'error' | 'unknown' }`.
- `setInfo.statusMessage` (if provided) must be a string.

### `app`

- `minimize(): Promise<void>`
- `hide(): Promise<void>`
- `show(): Promise<void>`
- `getVersion(): Promise<string>`
- `isPackaged(): Promise<boolean>`
- `quit(): Promise<void>`

### `storage` (non-sensitive)

- `get(key: string): Promise<string | null>`
- `set(key: string, value: string): Promise<void>`
- `remove(key: string): Promise<void>`
- `clear(): Promise<void>`

Validation:

- Key regex: `^[a-zA-Z0-9_.-]+$`
- Key length: `1..256`
- Value size: max `1MB`

### `secureStorage` (sensitive values)

- `get(key: string): Promise<string | null>`
- `set(key: string, value: string): Promise<void>`
- `remove(key: string): Promise<void>`
- `clear(): Promise<void>`

Backend behavior:

1. Primary: `keytar` (loaded dynamically if available)
2. Fallback: encrypted local store via Electron `safeStorage`

### `diagnostics`

- `copyToClipboard(): Promise<number>` (characters copied)
- `exportToFile(): Promise<string>` (export file path)
- `getLogPath(): Promise<string>`

### `updates`

- `getStatus(): Promise<UpdateInfo>`
- `checkNow(): Promise<UpdateInfo>`
- `installNow(): Promise<void>`
- `onStatusChange(callback): () => void`

Status union:

- `idle`
- `checking`
- `available`
- `not-available`
- `downloading`
- `downloaded`
- `error`

## Event Contract

Update status push event channel:

- IPC: `updates:statusChanged`
- Payload: `UpdateInfo`
- Subscription API: `electronBridge.updates.onStatusChange(cb)`

## IPC Channel Map

See `IPC_CHANNELS` in `src/shared/types.ts` for canonical names.

Highlights:

- Notifications: `notification:*`
- Tray: `tray:*`
- App: `app:*`
- Storage: `storage:*`
- Secure Storage: `secureStorage:*`
- Diagnostics: `diagnostics:*`
- Updates: `updates:*`

## Security and Validation Guarantees

The bridge enforces two layers:

1. Preload-side input validation before `ipcRenderer.invoke`
2. Main-side sender origin + payload validation before action execution

Main process rejects all invokes from untrusted origins, except controlled fallback-page IPC from the app-owned data URL.

## Integration Notes for Web App

- Treat every method as potentially throwing (origin rejection, invalid input, disabled feature, runtime backend failure).
- Always unsubscribe update listeners on component unmount.
- Use `window.electronBridge?.isElectron` to gate desktop-only features.
