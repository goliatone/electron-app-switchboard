/**
 * Shared type definitions for the Electron bridge API
 */

/** Notification options for native notifications */
export interface NotificationOptions {
  /** Optional icon path or URL */
  icon?: string;
  /** Whether the notification should be silent */
  silent?: boolean;
  /** Urgency level (Linux only) */
  urgency?: 'normal' | 'critical' | 'low';
  /** Tag to replace existing notification with same tag */
  tag?: string;
}

/** Tray connection status */
export type TrayStatus = 'connected' | 'degraded' | 'disconnected';

/** Health status for individual connected apps */
export type AppHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';

/** Information about a connected app */
export interface ConnectedAppInfo {
  /** Unique identifier for the app */
  id: string;
  /** Display name of the app */
  name: string;
  /** Health status of the app */
  status: AppHealthStatus;
}

/** Extended tray information for menu bar display */
export interface TrayInfo {
  /** Overall connection status */
  status: TrayStatus;
  /** List of connected apps with their status */
  connectedApps?: ConnectedAppInfo[];
  /** Custom status message to display */
  statusMessage?: string;
}

/** Auto-update status */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/** Update information */
export interface UpdateInfo {
  /** Current update status */
  status: UpdateStatus;
  /** Available version (if status is 'available', 'downloading', or 'downloaded') */
  version?: string;
  /** Download progress percentage (0-100, only when status is 'downloading') */
  progress?: number;
  /** Error message (only when status is 'error') */
  error?: string;
  /** Release notes (if available) */
  releaseNotes?: string;
}

/**
 * Electron Bridge API exposed to the renderer via contextBridge
 *
 * Available as `window.electronBridge` in the web app
 */
export interface ElectronBridge {
  /** Check if running in Electron */
  readonly isElectron: true;

  /** Native notifications */
  notifications: {
    /**
     * Show a native OS notification
     * @param title - Notification title
     * @param body - Notification body text
     * @param options - Optional notification settings
     */
    show(
      title: string,
      body: string,
      options?: NotificationOptions
    ): Promise<void>;

    /**
     * Request notification permission (mainly for display purposes)
     * @returns true if notifications are supported and enabled
     */
    requestPermission(): Promise<boolean>;
  };

  /** System tray controls */
  tray: {
    /**
     * Set the tray icon status indicator
     * @param status - Connection status to display
     */
    setStatus(status: TrayStatus): Promise<void>;

    /**
     * Set the tray badge count (macOS dock, Windows taskbar)
     * @param count - Badge count (0 to clear)
     */
    setBadge(count: number): Promise<void>;

    /**
     * Set extended tray info (connected apps, health status, etc.)
     * This updates the menu bar context menu with detailed information
     * @param info - Extended tray information
     */
    setInfo(info: TrayInfo): Promise<void>;

    /**
     * Get current tray info including uptime
     * @returns Current tray information with app uptime
     */
    getInfo(): Promise<TrayInfo & { uptime: number }>;
  };

  /** Application controls */
  app: {
    /** Minimize the main window */
    minimize(): Promise<void>;

    /** Hide the main window (to tray if configured) */
    hide(): Promise<void>;

    /** Show and focus the main window */
    show(): Promise<void>;

    /** Get the application version */
    getVersion(): Promise<string>;

    /** Check if running as a packaged app */
    isPackaged(): Promise<boolean>;

    /** Quit the application */
    quit(): Promise<void>;
  };

  /** Non-sensitive local storage */
  storage: {
    /**
     * Get a value from local storage
     * @param key - Storage key
     * @returns The stored value or null if not found
     */
    get(key: string): Promise<string | null>;

    /**
     * Set a value in local storage
     * @param key - Storage key
     * @param value - Value to store
     */
    set(key: string, value: string): Promise<void>;

    /**
     * Remove a value from local storage
     * @param key - Storage key
     */
    remove(key: string): Promise<void>;

    /**
     * Remove all non-sensitive local storage values
     */
    clear(): Promise<void>;
  };

  /** Secure storage (OS keychain) */
  secureStorage: {
    /**
     * Get a value from secure storage
     * @param key - Storage key
     * @returns The stored value or null if not found
     */
    get(key: string): Promise<string | null>;

    /**
     * Set a value in secure storage
     * @param key - Storage key
     * @param value - Value to store securely
     */
    set(key: string, value: string): Promise<void>;

    /**
     * Remove a value from secure storage
     * @param key - Storage key
     */
    remove(key: string): Promise<void>;

    /**
     * Remove all secure storage values
     */
    clear(): Promise<void>;
  };

  /** Diagnostics export and supportability actions */
  diagnostics: {
    /**
     * Copy recent diagnostics logs to system clipboard
     * @returns Number of characters copied
     */
    copyToClipboard(): Promise<number>;

    /**
     * Export diagnostics logs to a local file
     * @returns Full path to exported diagnostics file
     */
    exportToFile(): Promise<string>;

    /**
     * Get active diagnostics log file path
     */
    getLogPath(): Promise<string>;
  };

  /** Auto-update controls */
  updates: {
    /**
     * Get current update status
     * @returns Current update information
     */
    getStatus(): Promise<UpdateInfo>;

    /**
     * Manually check for updates
     * @returns Update information after check completes
     */
    checkNow(): Promise<UpdateInfo>;

    /**
     * Install downloaded update and restart the app
     * Only works when status is 'downloaded'
     */
    installNow(): Promise<void>;

    /**
     * Register a callback for update status changes
     * @param callback - Function called when status changes
     * @returns Unsubscribe function
     */
    onStatusChange(callback: (info: UpdateInfo) => void): () => void;
  };
}

/** IPC channel names */
export const IPC_CHANNELS = {
  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_PERMISSION: 'notification:permission',

  // Tray
  TRAY_SET_STATUS: 'tray:setStatus',
  TRAY_SET_BADGE: 'tray:setBadge',
  TRAY_SET_INFO: 'tray:setInfo',
  TRAY_GET_INFO: 'tray:getInfo',

  // App
  APP_MINIMIZE: 'app:minimize',
  APP_HIDE: 'app:hide',
  APP_SHOW: 'app:show',
  APP_GET_VERSION: 'app:getVersion',
  APP_IS_PACKAGED: 'app:isPackaged',
  APP_QUIT: 'app:quit',

  // Storage
  STORAGE_GET: 'storage:get',
  STORAGE_SET: 'storage:set',
  STORAGE_REMOVE: 'storage:remove',
  STORAGE_CLEAR: 'storage:clear',

  // Secure Storage
  SECURE_STORAGE_GET: 'secureStorage:get',
  SECURE_STORAGE_SET: 'secureStorage:set',
  SECURE_STORAGE_REMOVE: 'secureStorage:remove',
  SECURE_STORAGE_CLEAR: 'secureStorage:clear',

  // Diagnostics
  DIAGNOSTICS_COPY: 'diagnostics:copy',
  DIAGNOSTICS_EXPORT: 'diagnostics:export',
  DIAGNOSTICS_GET_LOG_PATH: 'diagnostics:getLogPath',

  // Updates
  UPDATES_GET_STATUS: 'updates:getStatus',
  UPDATES_CHECK_NOW: 'updates:checkNow',
  UPDATES_INSTALL_NOW: 'updates:installNow',
  UPDATES_STATUS_CHANGED: 'updates:statusChanged',
} as const;

/** Declare global window interface extension */
declare global {
  interface Window {
    electronBridge?: ElectronBridge;
  }
}
