/**
 * Unified Notification Service Types
 *
 * These types support a unified notification API that routes between
 * desktop (Electron) notifications and toast notifications based on
 * environment and configuration.
 */

import type { NotificationOptions } from '../types';

/**
 * Toast notification types for visual styling
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * Route taken by a notification
 */
export type NotifyRoute = 'desktop' | 'toast' | 'none';

/**
 * Toast action configuration
 */
export interface ToastAction {
  /** Action button label */
  label: string;
  /** Callback when action is clicked */
  onClick: () => void;
}

/**
 * Toast-specific notification options
 */
export interface ToastOptions {
  /** Visual type/style of the toast */
  type?: ToastType;
  /** Duration in milliseconds (0 for persistent) */
  duration?: number;
  /** Optional action button */
  action?: ToastAction;
}

/**
 * Desktop notification options - derived from bridge contract
 * Uses the same shape as ElectronBridge.notifications.show options
 */
export type DesktopOptions = NotificationOptions;

/**
 * Unified notification options
 */
export interface NotifyOptions {
  /** Notification title */
  title: string;
  /** Notification body/message */
  body: string;
  /** Force toast route even when desktop is available */
  preferToast?: boolean;
  /** Toast-specific options (used when routing to toast) */
  toast?: ToastOptions;
  /** Desktop-specific options (used when routing to desktop) */
  desktop?: DesktopOptions;
}

/**
 * Result returned from notify operations
 */
export interface NotifyResult {
  /** Which route was used */
  route: NotifyRoute;
  /** Whether fallback to toast was used after desktop failure */
  usedFallback: boolean;
  /** Error message if desktop attempt failed (normalized) */
  error?: string;
}

/**
 * Handler interface for toast notification adapters
 *
 * The web app registers a toast handler that implements this interface
 * to handle toast notifications using its preferred UI library.
 */
export interface ToastHandler {
  /**
   * Show a toast notification
   * @param title - Toast title
   * @param body - Toast message body
   * @param options - Toast display options
   */
  show(title: string, body: string, options?: ToastOptions): void;
}

/**
 * Convenience helper options (subset of NotifyOptions)
 */
export interface HelperOptions {
  /** Force toast route */
  preferToast?: boolean;
  /** Toast duration in milliseconds */
  duration?: number;
  /** Toast action button */
  action?: ToastAction;
  /** Desktop notification options */
  desktop?: DesktopOptions;
}
