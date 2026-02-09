/**
 * Compatibility Layer for Notification Service Migration
 *
 * This module provides utilities for incremental migration from direct
 * bridge/toast usage to the unified notification service.
 *
 * Use cases:
 * - N3.4: Compatibility wrappers for incremental migration
 * - Bridge legacy `window.notify` patterns to the unified service
 * - Support gradual adoption in large codebases
 */

import {
  notify,
  success,
  error,
  warning,
  info,
  toast,
  registerToastHandler,
  hasToastHandler,
  hasDesktopBridge,
} from './notification-service';

import type { NotifyOptions, NotifyResult, ToastHandler, ToastOptions } from './types';

// ============================================================================
// N3.4 - Compatibility Wrapper Types
// ============================================================================

/**
 * Legacy notification function signature (common pattern)
 */
export type LegacyNotifyFn = (
  title: string,
  body: string,
  options?: { type?: 'success' | 'error' | 'warning' | 'info' }
) => void;

/**
 * Legacy toast function signature
 */
export type LegacyToastFn = (
  message: string,
  type?: 'success' | 'error' | 'warning' | 'info'
) => void;

/**
 * Global notification API shape for window.notify pattern
 */
export interface GlobalNotifyAPI {
  /** Show notification (routes automatically) */
  (title: string, body: string, options?: Partial<NotifyOptions>): Promise<NotifyResult>;
  /** Show success notification */
  success: (title: string, body: string) => Promise<NotifyResult>;
  /** Show error notification */
  error: (title: string, body: string) => Promise<NotifyResult>;
  /** Show warning notification */
  warning: (title: string, body: string) => Promise<NotifyResult>;
  /** Show info notification */
  info: (title: string, body: string) => Promise<NotifyResult>;
  /** Show toast (always toast, never desktop) */
  toast: (title: string, body: string, options?: ToastOptions) => NotifyResult;
}

// ============================================================================
// N3.4 - Compatibility Wrappers
// ============================================================================

/**
 * Create a global notify API that can be attached to window
 *
 * Usage in consuming app:
 * ```typescript
 * import { createGlobalNotifyAPI } from 'electron-app-switchboard/notifications';
 *
 * // At app startup
 * window.notify = createGlobalNotifyAPI();
 *
 * // Then anywhere in the app
 * window.notify('Title', 'Body');
 * window.notify.success('Saved', 'Your changes were saved');
 * window.notify.toast('Copied', 'Text copied to clipboard');
 * ```
 */
export function createGlobalNotifyAPI(): GlobalNotifyAPI {
  const api = async (
    title: string,
    body: string,
    options?: Partial<NotifyOptions>
  ): Promise<NotifyResult> => {
    return notify({ title, body, ...options });
  };

  api.success = success;
  api.error = error;
  api.warning = warning;
  api.info = info;
  api.toast = toast;

  return api as GlobalNotifyAPI;
}

/**
 * Wrap a legacy notify function to use the unified service
 *
 * Useful for migrating code that uses simple notify(title, body, {type}) pattern
 */
export function wrapLegacyNotify(
  legacyFn: LegacyNotifyFn
): (title: string, body: string, options?: { type?: 'success' | 'error' | 'warning' | 'info' }) => Promise<NotifyResult> {
  return async (title, body, options) => {
    const type = options?.type ?? 'info';
    return notify({
      title,
      body,
      toast: { type },
    });
  };
}

/**
 * Wrap a legacy toast function to use the unified service
 *
 * Useful for migrating code that uses simple toast(message, type) pattern
 */
export function wrapLegacyToast(
  legacyFn: LegacyToastFn
): (message: string, type?: 'success' | 'error' | 'warning' | 'info') => NotifyResult {
  return (message, type = 'info') => {
    return toast('', message, { type });
  };
}

// ============================================================================
// N3.3 - Transient UX Event Helpers
// ============================================================================

/**
 * N3.3 - Transient UX helpers that always use toast
 *
 * These helpers are for inline feedback that should never go to desktop:
 * - copied: Clipboard copy confirmation
 * - saved: Quick save confirmation
 * - deleted: Item removal confirmation
 *
 * These remain toast-first regardless of runtime environment.
 */
export const transient = {
  /**
   * Show "copied to clipboard" feedback
   */
  copied(what?: string): NotifyResult {
    const message = what ? `${what} copied to clipboard` : 'Copied to clipboard';
    return toast('', message, { type: 'success' });
  },

  /**
   * Show "saved" feedback
   */
  saved(what?: string): NotifyResult {
    const message = what ? `${what} saved` : 'Saved';
    return toast('', message, { type: 'success' });
  },

  /**
   * Show "deleted" feedback
   */
  deleted(what?: string): NotifyResult {
    const message = what ? `${what} deleted` : 'Deleted';
    return toast('', message, { type: 'info' });
  },

  /**
   * Show "updated" feedback
   */
  updated(what?: string): NotifyResult {
    const message = what ? `${what} updated` : 'Updated';
    return toast('', message, { type: 'success' });
  },

  /**
   * Show generic inline feedback
   */
  feedback(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): NotifyResult {
    return toast('', message, { type });
  },
};

// ============================================================================
// N3.5 - Environment Branching Detection
// ============================================================================

/**
 * Check if code uses obsolete environment branching
 *
 * This helper can be used during migration to detect patterns like:
 * - if (window.electronBridge) { ... } else { toast(...) }
 * - isElectron ? desktopNotify() : toastNotify()
 *
 * The unified service handles this automatically.
 */
export function detectObsoletePatterns(): {
  usesDirectBridge: boolean;
  hasToastFallback: boolean;
  recommendation: string;
} {
  const usesDirectBridge = hasDesktopBridge();
  const hasToastFallback = hasToastHandler();

  let recommendation: string;
  if (usesDirectBridge && hasToastFallback) {
    recommendation = 'Environment ready. Use unified notify() API - it handles routing automatically.';
  } else if (usesDirectBridge && !hasToastFallback) {
    recommendation = 'Desktop bridge available but no toast handler. Register a toast adapter for fallback support.';
  } else if (!usesDirectBridge && hasToastFallback) {
    recommendation = 'Browser environment with toast handler. notify() will route to toast automatically.';
  } else {
    recommendation = 'No handlers available. Register a toast adapter before using notifications.';
  }

  return { usesDirectBridge, hasToastFallback, recommendation };
}

// ============================================================================
// Declare global window extension for compatibility
// ============================================================================

declare global {
  interface Window {
    notify?: GlobalNotifyAPI;
  }
}
