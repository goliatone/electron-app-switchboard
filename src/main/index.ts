/**
 * Electron Main Process Entry Point
 *
 * Implements secure-by-default desktop runtime for the Switchboard web app.
 */

import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Notification,
  Tray,
  Menu,
  nativeImage,
  NativeImage,
  safeStorage,
} from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';
import { loadConfig, isTrustedOrigin, AppConfig } from '../shared/config';
import { IPC_CHANNELS, TrayStatus, UpdateInfo, UpdateStatus } from '../shared/types';
import { extractDeepLinkFromArgv, parseDeepLink } from '../shared/deeplink';
import {
  LOCAL_STORAGE_NAMESPACE,
  SECURE_STORAGE_NAMESPACE,
  SECURE_KEY_INDEX,
  getLocalStorageKey,
  getSecureStorageKey,
  isValidStorageKey,
  resolveStoredValue,
} from '../shared/storage';
import {
  initializeDiagnostics,
  logDiagnostic,
  copyDiagnosticsToClipboard,
  exportDiagnosticsLog,
  getDiagnosticsLogPath,
} from './diagnostics';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const config: AppConfig = loadConfig();

// -----------------------------------------------------------------------------
// Global State
// -----------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentTrayStatus: TrayStatus = 'disconnected';
let isFallbackPageActive = false;
const pendingDeepLinks: string[] = [];
let localStore: Store<Record<string, string>> | null = null;

// Update state
let currentUpdateInfo: UpdateInfo = { status: 'idle' };
let updateCheckIntervalId: ReturnType<typeof setInterval> | null = null;

type KeytarClient = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials?(service: string): Promise<Array<{ account: string; password: string }>>;
};

const KEYCHAIN_SERVICE_NAME = 'Switchboard';
let keytarClient: KeytarClient | null = null;
let keytarLoadError: Error | null = null;
let secureFallbackStore: Store<Record<string, string>> | null = null;
let keytarFallbackWarned = false;

// -----------------------------------------------------------------------------
// Single Instance Lock
// -----------------------------------------------------------------------------

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    const deepLinkUrl = extractDeepLinkFromArgv(commandLine, config.deepLinkScheme);
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

// macOS deep-link events can arrive before app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    pendingDeepLinks.push(url);
  }
});

// -----------------------------------------------------------------------------
// Window Creation
// -----------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: !config.startInTray,
    title: 'Switchboard',
    webPreferences: {
      // Security: isolate renderer from Node.js
      contextIsolation: true,
      // Security: disable Node.js integration
      nodeIntegration: false,
      // Security: enable sandbox
      sandbox: true,
      // Security: disable remote module
      enableBlinkFeatures: '',
      // Preload script for bridge API
      preload: path.join(__dirname, '../preload/index.js'),
      // Security: enable web security
      webSecurity: true,
      // Security: disable webview tag
      webviewTag: false,
      // Security: disable plugins
      plugins: false,
      // Security: disable experimental features
      experimentalFeatures: false,
    },
  });

  // Load the remote app URL
  isFallbackPageActive = false;
  mainWindow.loadURL(config.appUrl).catch((err) => {
    console.error('Failed to load app URL:', err);
    logDiagnostic('error', 'window.load_url_failed', 'Failed to load APP_URL', {
      appUrl: config.appUrl,
      error: err,
    });
    loadFallbackPage('Connection Failed', `Unable to connect to ${config.appUrl}`);
  });

  // Handle load failures
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load: ${validatedURL} - ${errorCode}: ${errorDescription}`);
    logDiagnostic('warn', 'window.did_fail_load', 'BrowserWindow failed to load URL', {
      validatedURL,
      errorCode,
      errorDescription,
    });
    if (validatedURL === config.appUrl || validatedURL.startsWith(config.appUrl)) {
      loadFallbackPage('Connection Failed', `Unable to connect: ${errorDescription}`);
    }
  });

  // -----------------------------------------------------------------------------
  // Navigation Security
  // -----------------------------------------------------------------------------

  // Block navigation to untrusted origins
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDeepLinkUrl(url)) {
      event.preventDefault();
      handleDeepLink(url);
      return;
    }

    if (!isTrustedOrigin(url, config)) {
      console.warn(`Blocked navigation to untrusted URL: ${url}`);
      logDiagnostic('warn', 'navigation.blocked', 'Blocked navigation to untrusted URL', {
        url,
      });
      event.preventDefault();
      // Open in external browser instead
      shell.openExternal(url).catch(console.error);
    }
  });

  // Block new window creation for untrusted origins
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isDeepLinkUrl(url)) {
      handleDeepLink(url);
      return { action: 'deny' };
    }

    if (isTrustedOrigin(url, config)) {
      // Keep a single-window model: route trusted popups through the OS browser.
      logDiagnostic('info', 'window.popup_externalized', 'Trusted popup routed to external browser', {
        url,
      });
      shell.openExternal(url).catch(console.error);
      return { action: 'deny' };
    }
    // Open external URLs in system browser
    console.log(`Opening external URL in browser: ${url}`);
    logDiagnostic('warn', 'window.popup_blocked', 'Blocked popup to untrusted URL and opened externally', {
      url,
    });
    shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });

  // Prevent webview creation
  mainWindow.webContents.on('will-attach-webview', (event) => {
    console.warn('Blocked webview creation');
    logDiagnostic('warn', 'webview.blocked', 'Blocked webview attachment request');
    event.preventDefault();
  });

  // -----------------------------------------------------------------------------
  // Window Events
  // -----------------------------------------------------------------------------

  mainWindow.on('close', (event) => {
    if (!isQuitting && config.minimizeToTray) {
      event.preventDefault();
      logDiagnostic('info', 'window.minimize_to_tray', 'Intercepted close and hid window to tray');
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update tray status when page loads
  mainWindow.webContents.on('did-finish-load', () => {
    isFallbackPageActive = false;
    logDiagnostic('info', 'window.did_finish_load', 'Main window finished loading APP_URL');
    updateTrayStatus('connected');
  });

  return mainWindow;
}

function getMainWindow(): BrowserWindow {
  return mainWindow ?? createWindow();
}

function isDeepLinkUrl(url: string): boolean {
  return url.toLowerCase().startsWith(`${config.deepLinkScheme.toLowerCase()}://`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSettingsUrl(): string {
  try {
    return new URL('/settings', config.appUrl).toString();
  } catch {
    return config.appUrl;
  }
}

const SENSITIVE_LOG_PATTERNS = [
  /(access[-_]?token|refresh[-_]?token|auth(orization)?)/gi,
  /(api[-_]?key|secret|password|credential|session)/gi,
];

function redactLogText(value: string): string {
  let redacted = value;
  for (const pattern of SENSITIVE_LOG_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

function sanitizeErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return redactLogText(error.message);
  }
  if (typeof error === 'string') {
    return redactLogText(error);
  }
  return 'unknown';
}

function redactStorageKeyForLog(key: string): string {
  if (key.length <= 4) {
    return '*'.repeat(Math.max(1, key.length));
  }
  return `${key.slice(0, 2)}***${key.slice(-2)}`;
}

function logStorageEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: {
    key?: string;
    backend?: 'keytar' | 'safeStorage';
    count?: number;
    error?: unknown;
  }
): void {
  const parts: string[] = [];
  if (details?.key) parts.push(`key=${redactStorageKeyForLog(details.key)}`);
  if (details?.backend) parts.push(`backend=${details.backend}`);
  if (typeof details?.count === 'number') parts.push(`count=${details.count}`);
  if (details?.error !== undefined) parts.push(`error=${sanitizeErrorForLog(details.error)}`);

  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const line = `[storage] ${message}${suffix}`;
  logDiagnostic(level, 'storage.event', message, details);

  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function validateStorageKey(key: unknown): string {
  if (typeof key !== 'string') {
    throw new Error('Storage key must be a string');
  }
  if (key.length === 0 || key.length > 256) {
    throw new Error('Storage key length is invalid');
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
    throw new Error('Storage key contains invalid characters');
  }
  return key;
}

function validateStorageValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Storage value must be a string');
  }
  if (value.length > 1024 * 1024) {
    throw new Error('Storage value exceeds 1MB');
  }
  return value;
}

function getLocalStore(): Store<Record<string, string>> {
  if (!localStore) {
    localStore = new Store<Record<string, string>>({
      name: 'switchboard-store',
      clearInvalidConfig: true,
    });
  }
  return localStore;
}

function getLocalStoreKey(key: string): string {
  return getLocalStorageKey(key);
}

function localGetValue(key: string): string | null {
  const store = getLocalStore();
  const namespacedKey = getLocalStoreKey(key);
  const resolved = resolveStoredValue(store.get(namespacedKey), store.get(key));

  if (resolved.shouldMigrateLegacyValue && resolved.value !== null) {
    // Backward compatibility: migrate legacy unscoped keys to namespaced storage.
    store.set(namespacedKey, resolved.value);
    store.delete(key);
    logStorageEvent('info', 'Migrated legacy local storage key to namespace', { key });
  }

  return resolved.value;
}

function localSetValue(key: string, value: string): void {
  getLocalStore().set(getLocalStoreKey(key), value);
}

function localDeleteValue(key: string): void {
  const store = getLocalStore();
  store.delete(getLocalStoreKey(key));
  store.delete(key);
}

function clearLocalValues(): void {
  const store = getLocalStore();
  const keysToDelete = Object.keys(store.store).filter((key) =>
    key.startsWith(`${LOCAL_STORAGE_NAMESPACE}.`)
  );

  for (const key of keysToDelete) {
    store.delete(key);
  }

  logStorageEvent('info', 'Cleared local storage values', { count: keysToDelete.length });
}

function getSecureStoreKey(key: string): string {
  return getSecureStorageKey(key);
}

function getSecureKeychainAccount(key: string): string {
  return getSecureStoreKey(key);
}

function readSecureKeyIndex(): Set<string> {
  const raw = getLocalStore().get(SECURE_KEY_INDEX);
  if (typeof raw !== 'string' || raw.length === 0) {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    const values = parsed.filter(
      (entry): entry is string => typeof entry === 'string' && isValidStorageKey(entry)
    );
    return new Set<string>(values);
  } catch {
    logStorageEvent('warn', 'Secure key index was invalid and has been reset');
    getLocalStore().delete(SECURE_KEY_INDEX);
    return new Set<string>();
  }
}

function writeSecureKeyIndex(keys: Set<string>): void {
  const entries = Array.from(keys).sort();
  if (entries.length === 0) {
    getLocalStore().delete(SECURE_KEY_INDEX);
    return;
  }
  getLocalStore().set(SECURE_KEY_INDEX, JSON.stringify(entries));
}

function trackSecureKey(key: string): void {
  const keys = readSecureKeyIndex();
  keys.add(key);
  writeSecureKeyIndex(keys);
}

function untrackSecureKey(key: string): void {
  const keys = readSecureKeyIndex();
  keys.delete(key);
  writeSecureKeyIndex(keys);
}

function getTrackedSecureKeys(): string[] {
  return Array.from(readSecureKeyIndex());
}

function getSecureFallbackStore(): Store<Record<string, string>> {
  if (!secureFallbackStore) {
    secureFallbackStore = new Store<Record<string, string>>({
      name: 'switchboard-secure-fallback',
      clearInvalidConfig: true,
    });
  }
  return secureFallbackStore;
}

function canUseSafeStorageFallback(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function warnKeytarFallback(error: unknown): void {
  if (keytarFallbackWarned) return;
  keytarFallbackWarned = true;
  logStorageEvent('warn', 'Keychain integration unavailable. Falling back to encrypted local secure storage.', {
    backend: 'safeStorage',
    error,
  });
}

async function getKeytar(): Promise<KeytarClient> {
  if (keytarClient) return keytarClient;
  if (keytarLoadError) throw keytarLoadError;

  try {
    const moduleName = 'keytar';
    const requireFn = eval('require') as NodeRequire;
    const module = requireFn(moduleName) as unknown;
    const moduleValue = module as { default?: unknown };
    const resolved = (moduleValue.default ?? module) as Partial<KeytarClient>;

    if (
      typeof resolved.getPassword !== 'function' ||
      typeof resolved.setPassword !== 'function' ||
      typeof resolved.deletePassword !== 'function'
    ) {
      throw new Error('keytar module does not expose expected API');
    }

    keytarClient = resolved as KeytarClient;
    return keytarClient;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown keytar import error';
    keytarLoadError = new Error(`Keychain integration unavailable: ${message}`);
    throw keytarLoadError;
  }
}

async function secureSetValue(key: string, value: string): Promise<void> {
  const accountKey = getSecureKeychainAccount(key);
  const fallbackKey = getSecureStoreKey(key);

  try {
    const keytar = await getKeytar();
    await keytar.setPassword(KEYCHAIN_SERVICE_NAME, accountKey, value);
    trackSecureKey(key);
    return;
  } catch (error) {
    warnKeytarFallback(error);
  }

  if (!canUseSafeStorageFallback()) {
    throw keytarLoadError ?? new Error('No secure storage backend is available');
  }

  const encryptedValue = safeStorage.encryptString(value).toString('base64');
  getSecureFallbackStore().set(fallbackKey, encryptedValue);
  trackSecureKey(key);
}

function decryptFallbackSecureValue(encryptedValue: string, key: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
  } catch (error) {
    logStorageEvent('error', 'Failed to decrypt fallback secure value', {
      key,
      backend: 'safeStorage',
      error,
    });
    return null;
  }
}

async function secureGetValue(key: string): Promise<string | null> {
  const accountKey = getSecureKeychainAccount(key);
  const fallbackKey = getSecureStoreKey(key);

  try {
    const keytar = await getKeytar();
    const namespacedValue = await keytar.getPassword(KEYCHAIN_SERVICE_NAME, accountKey);
    const legacyValue = await keytar.getPassword(KEYCHAIN_SERVICE_NAME, key);
    const resolved = resolveStoredValue(namespacedValue, legacyValue);

    if (resolved.shouldMigrateLegacyValue && resolved.value !== null) {
      await keytar.setPassword(KEYCHAIN_SERVICE_NAME, accountKey, resolved.value);
      await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, key);
      trackSecureKey(key);
      logStorageEvent('info', 'Migrated legacy secure keychain entry to namespace', {
        key,
        backend: 'keytar',
      });
    }

    return resolved.value;
  } catch (error) {
    warnKeytarFallback(error);
  }

  if (!canUseSafeStorageFallback()) {
    throw keytarLoadError ?? new Error('No secure storage backend is available');
  }

  const fallbackStore = getSecureFallbackStore();
  const namespacedEncryptedValue = fallbackStore.get(fallbackKey);
  const legacyEncryptedValue = fallbackStore.get(key);
  const resolvedEncrypted = resolveStoredValue(namespacedEncryptedValue, legacyEncryptedValue);

  if (resolvedEncrypted.value !== null) {
    const decrypted = decryptFallbackSecureValue(resolvedEncrypted.value, key);
    if (resolvedEncrypted.shouldMigrateLegacyValue && decrypted !== null) {
      fallbackStore.set(fallbackKey, resolvedEncrypted.value);
      fallbackStore.delete(key);
      trackSecureKey(key);
      logStorageEvent('info', 'Migrated legacy secure fallback entry to namespace', {
        key,
        backend: 'safeStorage',
      });
    }
    return decrypted;
  }

  return null;
}

async function secureDeleteValue(key: string): Promise<void> {
  const accountKey = getSecureKeychainAccount(key);
  const fallbackKey = getSecureStoreKey(key);

  try {
    const keytar = await getKeytar();
    await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, accountKey);
    await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, key);
  } catch (error) {
    warnKeytarFallback(error);
  }

  const fallbackStore = getSecureFallbackStore();
  fallbackStore.delete(fallbackKey);
  fallbackStore.delete(key);
  untrackSecureKey(key);
}

async function clearSecureValues(): Promise<void> {
  const trackedKeys = getTrackedSecureKeys();
  let keychainDeleteCount = 0;

  try {
    const keytar = await getKeytar();
    if (typeof keytar.findCredentials === 'function') {
      const credentials = await keytar.findCredentials(KEYCHAIN_SERVICE_NAME);
      for (const credential of credentials) {
        try {
          await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, credential.account);
          keychainDeleteCount += 1;
        } catch (error) {
          logStorageEvent('warn', 'Failed to clear secure keychain entry', {
            key: credential.account,
            backend: 'keytar',
            error,
          });
        }
      }
    } else {
      for (const key of trackedKeys) {
        try {
          await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, getSecureKeychainAccount(key));
          await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, key);
          keychainDeleteCount += 1;
        } catch (error) {
          logStorageEvent('warn', 'Failed to clear secure keychain entry', {
            key,
            backend: 'keytar',
            error,
          });
        }
      }
    }
  } catch (error) {
    warnKeytarFallback(error);
  }

  const fallbackStore = getSecureFallbackStore();
  const fallbackKeysToDelete = Object.keys(fallbackStore.store);
  for (const key of fallbackKeysToDelete) {
    fallbackStore.delete(key);
  }

  writeSecureKeyIndex(new Set<string>());
  logStorageEvent('info', 'Cleared secure storage values', {
    count: Math.max(keychainDeleteCount, fallbackKeysToDelete.length, trackedKeys.length),
  });
}

function registerDeepLinkProtocol(): void {
  if (!config.enableDeepLinks) return;

  const registered = app.setAsDefaultProtocolClient(config.deepLinkScheme);
  console.log(
    registered
      ? `Registered deep-link protocol: ${config.deepLinkScheme}://`
      : `Protocol registration skipped/failed: ${config.deepLinkScheme}://`
  );
}

function handleDeepLink(rawUrl: string): void {
  if (!config.enableDeepLinks) {
    console.warn(`Deep link ignored because deep links are disabled: ${rawUrl}`);
    logDiagnostic('warn', 'deeplink.disabled', 'Ignored deep link because feature is disabled', {
      rawUrl,
    });
    return;
  }

  const parsed = parseDeepLink(rawUrl, config.deepLinkScheme);
  if (!parsed) {
    console.warn(`Ignored invalid deep link: ${rawUrl}`);
    logDiagnostic('warn', 'deeplink.invalid', 'Ignored invalid deep link', { rawUrl });
    return;
  }

  logDiagnostic('info', 'deeplink.accepted', 'Handling deep link', { rawUrl, parsed });

  const windowRef = getMainWindow();

  switch (parsed.kind) {
    case 'action':
      if (parsed.action === 'quit') {
        isQuitting = true;
        app.quit();
        return;
      }

      if (parsed.action === 'reload') {
        windowRef.loadURL(config.appUrl).catch((error) => {
          console.error('Failed to reload APP_URL from deep link:', error);
          loadFallbackPage('Connection Failed', `Unable to connect to ${config.appUrl}`);
        });
      } else if (parsed.action === 'settings') {
        windowRef.loadURL(buildSettingsUrl()).catch((error) => {
          console.error('Failed to open settings from deep link:', error);
          loadFallbackPage('Connection Failed', 'Unable to open settings');
        });
      } else {
        windowRef.show();
        windowRef.focus();
      }
      return;

    case 'route': {
      const targetUrl = new URL(parsed.path, config.appUrl).toString();
      windowRef.loadURL(targetUrl).catch((error) => {
        console.error('Failed to open deep-link route:', error);
        loadFallbackPage('Connection Failed', 'Unable to open deep-link route');
      });
      windowRef.show();
      windowRef.focus();
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Auto-Update Functions
// -----------------------------------------------------------------------------

/**
 * Broadcast update status change to all renderer processes
 */
function broadcastUpdateStatus(info: UpdateInfo): void {
  currentUpdateInfo = info;
  mainWindow?.webContents.send(IPC_CHANNELS.UPDATES_STATUS_CHANGED, info);
}

/**
 * Get current update info
 */
function getUpdateInfo(): UpdateInfo {
  return { ...currentUpdateInfo };
}

/**
 * Manually trigger an update check
 */
async function checkForUpdatesNow(): Promise<UpdateInfo> {
  if (!app.isPackaged) {
    return { status: 'idle', error: 'Updates disabled in development mode' };
  }

  if (!config.enableAutoUpdate) {
    return { status: 'idle', error: 'Auto-updates are disabled by configuration' };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      return {
        status: currentUpdateInfo.status,
        version: result.updateInfo.version,
        releaseNotes: typeof result.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
      };
    }
    return getUpdateInfo();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { status: 'error', error: errorMessage };
  }
}

/**
 * Install downloaded update and restart
 */
function installUpdateNow(): void {
  if (currentUpdateInfo.status !== 'downloaded') {
    throw new Error('No update is downloaded and ready to install');
  }
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Setup auto-updater with full functionality
 */
function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('Skipping auto-updater in development mode');
    broadcastUpdateStatus({ status: 'idle', error: 'Development mode' });
    return;
  }

  if (!config.enableAutoUpdate) {
    console.log('Auto-updates disabled by configuration');
    broadcastUpdateStatus({ status: 'idle', error: 'Disabled by configuration' });
    return;
  }

  // Configure auto-updater
  (autoUpdater as { channel?: string }).channel = config.updateChannel;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Event: checking for update
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    broadcastUpdateStatus({ status: 'checking' });
  });

  // Event: update available
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    broadcastUpdateStatus({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
    updateTrayStatus('degraded');
  });

  // Event: no update available
  autoUpdater.on('update-not-available', (info) => {
    console.log('No updates available (current:', info.version, ')');
    broadcastUpdateStatus({
      status: 'not-available',
      version: info.version,
    });
    if (!isFallbackPageActive) updateTrayStatus('connected');
  });

  // Event: download progress
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`Download progress: ${percent}%`);
    broadcastUpdateStatus({
      status: 'downloading',
      version: currentUpdateInfo.version,
      progress: percent,
      releaseNotes: currentUpdateInfo.releaseNotes,
    });
  });

  // Event: update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    broadcastUpdateStatus({
      status: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });

    // Show notification
    if (config.enableNotifications && Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update Ready',
        body: `Version ${info.version} is ready to install. Restart to update.`,
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    }
  });

  // Event: error
  autoUpdater.on('error', (error) => {
    console.error('Auto-update error:', error);
    broadcastUpdateStatus({
      status: 'error',
      version: currentUpdateInfo.version,
      error: error.message,
    });
    updateTrayStatus('degraded');
  });

  // Initial update check
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Initial update check failed:', error);
    broadcastUpdateStatus({
      status: 'error',
      error: error instanceof Error ? error.message : 'Initial check failed',
    });
  });

  // Setup periodic checks if configured
  if (config.updateCheckInterval > 0) {
    const intervalMs = config.updateCheckInterval * 60 * 60 * 1000;
    console.log(`Scheduling update checks every ${config.updateCheckInterval} hours`);

    updateCheckIntervalId = setInterval(() => {
      console.log('Running scheduled update check...');
      autoUpdater.checkForUpdates().catch((error) => {
        console.error('Scheduled update check failed:', error);
      });
    }, intervalMs);
  }
}

// -----------------------------------------------------------------------------
// Fallback Page
// -----------------------------------------------------------------------------

function loadFallbackPage(title: string, message: string): void {
  isFallbackPageActive = true;
  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);
  const escapedAppUrl = escapeHtml(config.appUrl);
  const appUrlJs = JSON.stringify(config.appUrl);
  const settingsUrlJs = JSON.stringify(buildSettingsUrl());

  const fallbackHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
      <title>${escapedTitle}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: #e8e8e8;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          text-align: center;
          padding: 40px;
          max-width: 500px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 24px;
        }
        h1 {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 16px;
        }
        p {
          color: #a0a0a0;
          margin-bottom: 32px;
          line-height: 1.6;
        }
        .actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }
        button {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-primary {
          background: #4f46e5;
          color: white;
        }
        .btn-primary:hover {
          background: #4338ca;
        }
        .btn-secondary {
          background: #374151;
          color: #e8e8e8;
        }
        .btn-secondary:hover {
          background: #4b5563;
        }
        .btn-danger {
          background: #dc2626;
          color: white;
        }
        .btn-danger:hover {
          background: #b91c1c;
        }
        .url {
          font-family: monospace;
          font-size: 12px;
          color: #6b7280;
          margin-top: 24px;
          word-break: break-all;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⚠️</div>
        <h1>${escapedTitle}</h1>
        <p>${escapedMessage}</p>
        <div class="actions">
          <button class="btn-primary" onclick="retry()">Retry Connection</button>
          <button class="btn-secondary" onclick="openSettings()">Settings</button>
          <button class="btn-danger" onclick="quitApp()">Quit</button>
        </div>
        <p class="url">Attempting to connect to: ${escapedAppUrl}</p>
      </div>
      <script>
        function retry() {
          window.location.replace(${appUrlJs});
        }
        function openSettings() {
          window.location.replace(${settingsUrlJs});
        }
        function quitApp() {
          if (window.electronBridge && window.electronBridge.app && window.electronBridge.app.quit) {
            window.electronBridge.app.quit();
          } else {
            window.close();
          }
        }
      </script>
    </body>
    </html>
  `;

  mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
  updateTrayStatus('disconnected');
}

// -----------------------------------------------------------------------------
// System Tray
// -----------------------------------------------------------------------------

function createTray(): void {
  // Use a simple 16x16 icon (placeholder - replace with actual icon)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets/icons/tray-icon.png')
    : path.join(__dirname, '../../assets/icons/tray-icon.png');

  // Create a simple placeholder icon if the file doesn't exist
  let trayIcon: NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = createPlaceholderTrayIcon();
    }
  } catch {
    trayIcon = createPlaceholderTrayIcon();
  }

  // On macOS, use template image for dark/light mode support
  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Switchboard');

  updateTrayMenu();

  tray.on('click', () => {
    logDiagnostic('debug', 'tray.click', 'Tray icon clicked');
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  tray.on('double-click', () => {
    logDiagnostic('debug', 'tray.double_click', 'Tray icon double-clicked');
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function createPlaceholderTrayIcon(): NativeImage {
  // Create a simple 16x16 placeholder icon
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  // Fill with a simple circle pattern
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist <= r) {
        // Inside circle - use status color
        const color = getStatusColor(currentTrayStatus);
        canvas[idx] = color.r;     // R
        canvas[idx + 1] = color.g; // G
        canvas[idx + 2] = color.b; // B
        canvas[idx + 3] = 255;     // A
      } else {
        // Outside circle - transparent
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function getStatusColor(status: TrayStatus): { r: number; g: number; b: number } {
  switch (status) {
    case 'connected':
      return { r: 34, g: 197, b: 94 };  // Green
    case 'degraded':
      return { r: 234, g: 179, b: 8 };  // Yellow
    case 'disconnected':
      return { r: 239, g: 68, b: 68 };  // Red
  }
}

function updateTrayMenu(): void {
  if (!tray) return;

  const statusText =
    currentTrayStatus === 'connected' ? '● Connected' :
    currentTrayStatus === 'degraded' ? '◐ Degraded' :
    '○ Disconnected';

  const contextMenu = Menu.buildFromTemplate([
    { label: statusText, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Switchboard',
      click: () => {
        logDiagnostic('info', 'tray.open_click', 'Open Switchboard selected from tray menu');
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Reload',
      click: () => {
        logDiagnostic('info', 'tray.reload_click', 'Reload selected from tray menu');
        isFallbackPageActive = false;
        mainWindow?.loadURL(config.appUrl).catch(() => {
          loadFallbackPage('Connection Failed', `Unable to connect to ${config.appUrl}`);
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        logDiagnostic('info', 'tray.quit_click', 'Quit selected from tray menu');
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function updateTrayStatus(status: TrayStatus): void {
  currentTrayStatus = status;
  logDiagnostic('info', 'tray.status_changed', 'Tray status updated', { status });
  if (tray) {
    tray.setImage(createPlaceholderTrayIcon());
    updateTrayMenu();
  }
}

// -----------------------------------------------------------------------------
// IPC Handlers
// -----------------------------------------------------------------------------

function setupIpcHandlers(): void {
  // Validate sender origin for all IPC calls
  const validateSender = (event: Electron.IpcMainInvokeEvent): boolean => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) {
      logDiagnostic('warn', 'ipc.sender_invalid', 'Rejected IPC call with missing sender URL');
      return false;
    }
    if (isTrustedOrigin(senderUrl, config)) return true;

    // Allow fallback page (data URL) only for this app window.
    if (
      isFallbackPageActive &&
      senderUrl.startsWith('data:text/html') &&
      event.sender === mainWindow?.webContents
    ) {
      return true;
    }

    logDiagnostic('warn', 'ipc.sender_untrusted', 'Rejected IPC call from untrusted sender', {
      senderUrl,
    });
    return false;
  };

  // Notifications
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SHOW, async (event, title: string, body: string, options?: unknown) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    if (!config.enableNotifications) {
      throw new Error('Notifications are disabled by configuration');
    }
    if (typeof title !== 'string' || typeof body !== 'string') {
      throw new Error('Notification title and body must be strings');
    }
    if (title.length === 0 || title.length > 256 || body.length > 2048) {
      throw new Error('Notification payload is invalid');
    }
    if (!Notification.isSupported()) {
      console.warn('Notifications not supported on this platform');
      return;
    }
    const notification = new Notification({
      title,
      body,
      silent: (options as { silent?: boolean })?.silent ?? false,
    });
    notification.on('click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    notification.show();
  });

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_PERMISSION, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return config.enableNotifications && Notification.isSupported();
  });

  // Tray
  ipcMain.handle(IPC_CHANNELS.TRAY_SET_STATUS, async (event, status: TrayStatus) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    if (!['connected', 'degraded', 'disconnected'].includes(status)) {
      throw new Error('Invalid tray status');
    }
    updateTrayStatus(status);
  });

  ipcMain.handle(IPC_CHANNELS.TRAY_SET_BADGE, async (event, count: number) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    if (typeof count !== 'number' || count < 0) {
      throw new Error('Invalid badge count');
    }
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    }
    // macOS v1: dock badge only.
  });

  // App controls
  ipcMain.handle(IPC_CHANNELS.APP_MINIMIZE, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    mainWindow?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.APP_HIDE, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    mainWindow?.hide();
  });

  ipcMain.handle(IPC_CHANNELS.APP_SHOW, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    mainWindow?.show();
    mainWindow?.focus();
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.APP_IS_PACKAGED, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return app.isPackaged;
  });

  ipcMain.handle(IPC_CHANNELS.APP_QUIT, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    isQuitting = true;
    app.quit();
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_GET, async (event, _key: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    return localGetValue(key);
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_SET, async (event, _key: string, _value: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    const value = validateStorageValue(_value);
    localSetValue(key, value);
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_REMOVE, async (event, _key: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    localDeleteValue(key);
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEAR, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    clearLocalValues();
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_GET, async (event, _key: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    return await secureGetValue(key);
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_SET, async (event, _key: string, _value: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    const value = validateStorageValue(_value);
    await secureSetValue(key, value);
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_REMOVE, async (event, _key: string) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    const key = validateStorageKey(_key);
    await secureDeleteValue(key);
  });

  ipcMain.handle(IPC_CHANNELS.SECURE_STORAGE_CLEAR, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    await clearSecureValues();
  });

  // Diagnostics
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_COPY, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return copyDiagnosticsToClipboard();
  });

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_EXPORT, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return exportDiagnosticsLog();
  });

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_GET_LOG_PATH, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return getDiagnosticsLogPath();
  });

  // Updates
  ipcMain.handle(IPC_CHANNELS.UPDATES_GET_STATUS, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return getUpdateInfo();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATES_CHECK_NOW, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    return await checkForUpdatesNow();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATES_INSTALL_NOW, async (event) => {
    if (!validateSender(event)) {
      throw new Error('IPC call from untrusted origin');
    }
    installUpdateNow();
  });
}

// -----------------------------------------------------------------------------
// App Lifecycle
// -----------------------------------------------------------------------------

app.whenReady().then(() => {
  initializeDiagnostics(config.logLevel);
  logDiagnostic('info', 'app.start', 'Switchboard startup sequence initiated', {
    appUrl: config.appUrl,
    trustedOrigins: config.trustedOrigins,
    deepLinkScheme: config.deepLinkScheme,
    autoUpdateEnabled: config.enableAutoUpdate,
  });

  console.log('Switchboard starting...');
  console.log(`App URL: ${config.appUrl}`);
  console.log(`Trusted origins: ${config.trustedOrigins.join(', ')}`);

  registerDeepLinkProtocol();
  setupIpcHandlers();
  createWindow();
  createTray();
  setupAutoUpdater();

  // Handle deep link from initial process args (fallback for non-macOS dispatch paths).
  const startupDeepLink = extractDeepLinkFromArgv(process.argv, config.deepLinkScheme);
  if (startupDeepLink) {
    handleDeepLink(startupDeepLink);
  }

  // Replay deep links queued before app readiness.
  while (pendingDeepLinks.length > 0) {
    const deepLinkUrl = pendingDeepLinks.shift();
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  }

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      logDiagnostic('info', 'app.activate_recreate', 'Recreating main window on activate');
      createWindow();
    } else {
      logDiagnostic('debug', 'app.activate_show', 'Showing existing main window on activate');
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  logDiagnostic('info', 'app.window_all_closed', 'All windows closed', {
    platform: process.platform,
    minimizeToTray: config.minimizeToTray,
  });
  if (process.platform !== 'darwin' || !config.minimizeToTray) {
    app.quit();
  }
});

app.on('before-quit', () => {
  logDiagnostic('info', 'app.before_quit', 'Application is quitting');
  isQuitting = true;
});

// Security: Disable navigation to file:// URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      console.warn('Blocked navigation to file:// URL');
      logDiagnostic('warn', 'navigation.file_blocked', 'Blocked file:// navigation', { url });
      event.preventDefault();
    }
  });
});

console.log('Main process initialized');
