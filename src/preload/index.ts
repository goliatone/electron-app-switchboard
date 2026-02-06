/**
 * Preload Script
 *
 * Exposes a secure, typed bridge API to the renderer (web app) via contextBridge.
 * This is the only way the renderer can communicate with the main process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  ElectronBridge,
  IPC_CHANNELS,
  NotificationOptions,
  TrayStatus,
  UpdateInfo,
} from '../shared/types';

/**
 * Validate that a value is a non-empty string
 */
function validateString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

/**
 * Validate that a value is a number
 */
function validateNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

/**
 * Validate tray status value
 */
function validateTrayStatus(value: unknown): TrayStatus {
  if (value !== 'connected' && value !== 'degraded' && value !== 'disconnected') {
    throw new Error('Invalid tray status');
  }
  return value;
}

/**
 * Validate notification options
 */
function validateNotificationOptions(options: unknown): NotificationOptions | undefined {
  if (options === undefined || options === null) {
    return undefined;
  }
  if (typeof options !== 'object') {
    throw new Error('Notification options must be an object');
  }
  const opts = options as Record<string, unknown>;
  const result: NotificationOptions = {};

  if (opts.icon !== undefined) {
    result.icon = validateString(opts.icon, 'icon');
  }
  if (opts.silent !== undefined) {
    if (typeof opts.silent !== 'boolean') {
      throw new Error('silent must be a boolean');
    }
    result.silent = opts.silent;
  }
  if (opts.urgency !== undefined) {
    if (opts.urgency !== 'normal' && opts.urgency !== 'critical' && opts.urgency !== 'low') {
      throw new Error('Invalid urgency value');
    }
    result.urgency = opts.urgency;
  }
  if (opts.tag !== undefined) {
    result.tag = validateString(opts.tag, 'tag');
  }

  return result;
}

/**
 * Validate storage key
 */
function validateStorageKey(key: unknown): string {
  const keyStr = validateString(key, 'key');
  // Limit key length and characters for safety
  if (keyStr.length > 256) {
    throw new Error('Storage key too long');
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(keyStr)) {
    throw new Error('Storage key contains invalid characters');
  }
  return keyStr;
}

/**
 * Validate storage value
 */
function validateStorageValue(value: unknown): string {
  const valueStr = validateString(value, 'value');
  // Limit value size (1MB)
  if (valueStr.length > 1024 * 1024) {
    throw new Error('Storage value too large');
  }
  return valueStr;
}

/**
 * The bridge API exposed to the renderer
 */
const electronBridge: ElectronBridge = {
  isElectron: true,

  notifications: {
    async show(
      title: string,
      body: string,
      options?: NotificationOptions
    ): Promise<void> {
      const validTitle = validateString(title, 'title');
      const validBody = validateString(body, 'body');
      const validOptions = validateNotificationOptions(options);
      await ipcRenderer.invoke(
        IPC_CHANNELS.NOTIFICATION_SHOW,
        validTitle,
        validBody,
        validOptions
      );
    },

    async requestPermission(): Promise<boolean> {
      return ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_PERMISSION);
    },
  },

  tray: {
    async setStatus(status: TrayStatus): Promise<void> {
      const validStatus = validateTrayStatus(status);
      await ipcRenderer.invoke(IPC_CHANNELS.TRAY_SET_STATUS, validStatus);
    },

    async setBadge(count: number): Promise<void> {
      const validCount = validateNumber(count, 'count');
      if (validCount < 0) {
        throw new Error('Badge count must be non-negative');
      }
      await ipcRenderer.invoke(IPC_CHANNELS.TRAY_SET_BADGE, validCount);
    },
  },

  app: {
    async minimize(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.APP_MINIMIZE);
    },

    async hide(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.APP_HIDE);
    },

    async show(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.APP_SHOW);
    },

    async getVersion(): Promise<string> {
      return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION);
    },

    async isPackaged(): Promise<boolean> {
      return ipcRenderer.invoke(IPC_CHANNELS.APP_IS_PACKAGED);
    },

    async quit(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT);
    },
  },

  storage: {
    async get(key: string): Promise<string | null> {
      const validKey = validateStorageKey(key);
      return ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET, validKey);
    },

    async set(key: string, value: string): Promise<void> {
      const validKey = validateStorageKey(key);
      const validValue = validateStorageValue(value);
      await ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET, validKey, validValue);
    },

    async remove(key: string): Promise<void> {
      const validKey = validateStorageKey(key);
      await ipcRenderer.invoke(IPC_CHANNELS.STORAGE_REMOVE, validKey);
    },

    async clear(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CLEAR);
    },
  },

  secureStorage: {
    async get(key: string): Promise<string | null> {
      const validKey = validateStorageKey(key);
      return ipcRenderer.invoke(IPC_CHANNELS.SECURE_STORAGE_GET, validKey);
    },

    async set(key: string, value: string): Promise<void> {
      const validKey = validateStorageKey(key);
      const validValue = validateStorageValue(value);
      await ipcRenderer.invoke(IPC_CHANNELS.SECURE_STORAGE_SET, validKey, validValue);
    },

    async remove(key: string): Promise<void> {
      const validKey = validateStorageKey(key);
      await ipcRenderer.invoke(IPC_CHANNELS.SECURE_STORAGE_REMOVE, validKey);
    },

    async clear(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.SECURE_STORAGE_CLEAR);
    },
  },

  diagnostics: {
    async copyToClipboard(): Promise<number> {
      return ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_COPY);
    },

    async exportToFile(): Promise<string> {
      return ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT);
    },

    async getLogPath(): Promise<string> {
      return ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_GET_LOG_PATH);
    },
  },

  updates: {
    async getStatus(): Promise<UpdateInfo> {
      return ipcRenderer.invoke(IPC_CHANNELS.UPDATES_GET_STATUS);
    },

    async checkNow(): Promise<UpdateInfo> {
      return ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK_NOW);
    },

    async installNow(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.UPDATES_INSTALL_NOW);
    },

    onStatusChange(callback: (info: UpdateInfo) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateInfo) => {
        callback(info);
      };
      ipcRenderer.on(IPC_CHANNELS.UPDATES_STATUS_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATES_STATUS_CHANGED, handler);
      };
    },
  },
};

// Expose the bridge API to the renderer
contextBridge.exposeInMainWorld('electronBridge', electronBridge);

console.log('Electron bridge initialized');
