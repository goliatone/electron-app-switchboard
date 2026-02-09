/**
 * Unified Notification Service
 *
 * Provides a single API for notifications that automatically routes between
 * desktop (Electron) and toast notifications based on environment and configuration.
 *
 * Features:
 * - Automatic route selection (desktop vs toast)
 * - Desktop capability detection
 * - Permission preflight with caching
 * - Graceful fallback from desktop to toast
 * - Route metadata for debugging
 */

import type {
  NotifyOptions,
  NotifyResult,
  NotifyRoute,
  ToastHandler,
  ToastType,
  ToastOptions,
  HelperOptions,
} from './types';

// ============================================================================
// State
// ============================================================================

/** Registered toast handler */
let toastHandler: ToastHandler | null = null;

/** Cached permission preflight result */
let permissionCache: boolean | null = null;

/** In-flight permission check promise for deduplication */
let permissionCheckInFlight: Promise<boolean> | null = null;

/** Debug logging enabled flag */
let debugLogging = false;

// ============================================================================
// Logging
// ============================================================================

/**
 * Log a debug message with route information
 * Redacts notification content for safety
 */
function logRoute(
  action: string,
  route: NotifyRoute,
  details?: Record<string, unknown>
): void {
  if (!debugLogging) return;

  const safeDetails = details ? { ...details } : {};
  // Redact potentially sensitive content
  delete safeDetails.title;
  delete safeDetails.body;

  console.debug(`[notify] ${action}`, { route, ...safeDetails });
}

/**
 * Enable or disable debug logging
 */
export function setDebugLogging(enabled: boolean): void {
  debugLogging = enabled;
}

// ============================================================================
// N1.2 - Desktop Capability Guard
// ============================================================================

/**
 * Check if the desktop notification bridge is available
 * Validates that the bridge exists and has callable methods
 */
export function hasDesktopBridge(): boolean {
  const bridge = window.electronBridge;

  if (!bridge) {
    return false;
  }

  // Validate callable methods exist (not just isElectron check)
  if (
    typeof bridge.notifications?.show !== 'function' ||
    typeof bridge.notifications?.requestPermission !== 'function'
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// N1.3 - Permission Preflight
// ============================================================================

/**
 * Check if desktop notifications are permitted
 * Uses in-memory caching and in-flight promise deduplication
 */
async function checkDesktopPermission(): Promise<boolean> {
  // Return cached result if available
  if (permissionCache !== null) {
    logRoute('permission_cached', 'desktop', { permitted: permissionCache });
    return permissionCache;
  }

  // Deduplicate concurrent permission checks
  if (permissionCheckInFlight !== null) {
    logRoute('permission_dedupe', 'desktop');
    return permissionCheckInFlight;
  }

  // Perform the permission check
  permissionCheckInFlight = (async () => {
    try {
      const bridge = window.electronBridge;
      if (!bridge?.notifications?.requestPermission) {
        permissionCache = false;
        return false;
      }

      const permitted = await bridge.notifications.requestPermission();
      permissionCache = permitted;
      logRoute('permission_check', 'desktop', { permitted });
      return permitted;
    } catch (err) {
      logRoute('permission_error', 'desktop', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      permissionCache = false;
      return false;
    } finally {
      permissionCheckInFlight = null;
    }
  })();

  return permissionCheckInFlight;
}

/**
 * Reset the permission cache
 * Useful for tests and hot-reload scenarios
 */
export function resetPermissionCache(): void {
  permissionCache = null;
  permissionCheckInFlight = null;
  logRoute('permission_reset', 'none');
}

/**
 * Check if desktop notifications can be used
 * Combines capability check with permission preflight
 */
export async function canUseDesktop(): Promise<boolean> {
  if (!hasDesktopBridge()) {
    return false;
  }
  return checkDesktopPermission();
}

// ============================================================================
// N1.4 - Toast Handler Registration
// ============================================================================

/**
 * Register a toast handler for displaying toast notifications
 * @param handler - Toast handler implementation
 * @returns Unregister function for cleanup
 */
export function registerToastHandler(handler: ToastHandler): () => void {
  if (toastHandler !== null) {
    console.warn(
      '[notify] Toast handler already registered. Replacing existing handler.'
    );
  }

  toastHandler = handler;
  logRoute('handler_registered', 'toast');

  // Return unregister function
  return () => {
    if (toastHandler === handler) {
      toastHandler = null;
      logRoute('handler_unregistered', 'toast');
    }
  };
}

/**
 * Check if a toast handler is registered
 */
export function hasToastHandler(): boolean {
  return toastHandler !== null;
}

// ============================================================================
// N1.5 - Core Notify Function
// ============================================================================

/**
 * Show a toast notification
 */
function showToast(
  title: string,
  body: string,
  options?: ToastOptions
): NotifyResult {
  if (!toastHandler) {
    logRoute('toast_no_handler', 'none');
    return { route: 'none', usedFallback: false, error: 'No toast handler registered' };
  }

  try {
    toastHandler.show(title, body, options);
    logRoute('toast_shown', 'toast', { type: options?.type });
    return { route: 'toast', usedFallback: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Toast display failed';
    logRoute('toast_error', 'none', { error: errorMsg });
    return { route: 'none', usedFallback: false, error: errorMsg };
  }
}

/**
 * Attempt to show a desktop notification
 */
async function showDesktop(
  title: string,
  body: string,
  options?: NotifyOptions['desktop']
): Promise<{ success: boolean; error?: string }> {
  try {
    const bridge = window.electronBridge;
    if (!bridge?.notifications?.show) {
      return { success: false, error: 'Desktop bridge not available' };
    }

    await bridge.notifications.show(title, body, options);
    logRoute('desktop_shown', 'desktop');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Desktop notification failed';
    logRoute('desktop_error', 'desktop', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Send a notification using the unified API
 *
 * Route selection logic:
 * 1. If preferToast is true, route to toast
 * 2. If desktop capability exists and permission is granted, attempt desktop
 * 3. If desktop fails, fallback to toast
 * 4. If no desktop capability, route to toast
 */
export async function notify(options: NotifyOptions): Promise<NotifyResult> {
  const { title, body, preferToast, toast: toastOptions, desktop: desktopOptions } = options;

  logRoute('notify_start', 'none', { preferToast, hasToastOpts: !!toastOptions });

  // Route 1: Force toast when preferToast is set
  if (preferToast) {
    logRoute('route_prefer_toast', 'toast');
    return showToast(title, body, toastOptions);
  }

  // Route 2: Check if desktop is available
  const desktopAvailable = await canUseDesktop();

  if (!desktopAvailable) {
    logRoute('route_no_desktop', 'toast');
    return showToast(title, body, toastOptions);
  }

  // Route 3: Attempt desktop notification
  const desktopResult = await showDesktop(title, body, desktopOptions);

  if (desktopResult.success) {
    return { route: 'desktop', usedFallback: false };
  }

  // Route 4: Fallback to toast on desktop failure
  logRoute('route_fallback', 'toast', { error: desktopResult.error });
  const toastResult = showToast(title, body, toastOptions);

  return {
    route: toastResult.route,
    usedFallback: toastResult.route === 'toast',
    error: desktopResult.error,
  };
}

// ============================================================================
// N1.6 - Convenience Helpers
// ============================================================================

/**
 * Build NotifyOptions from helper parameters
 */
function buildOptions(
  title: string,
  body: string,
  type: ToastType,
  opts?: HelperOptions
): NotifyOptions {
  return {
    title,
    body,
    preferToast: opts?.preferToast,
    toast: {
      type,
      duration: opts?.duration,
      action: opts?.action,
    },
    desktop: opts?.desktop,
  };
}

/**
 * Show a success notification
 */
export async function success(
  title: string,
  body: string,
  options?: HelperOptions
): Promise<NotifyResult> {
  return notify(buildOptions(title, body, 'success', options));
}

/**
 * Show an error notification
 */
export async function error(
  title: string,
  body: string,
  options?: HelperOptions
): Promise<NotifyResult> {
  return notify(buildOptions(title, body, 'error', options));
}

/**
 * Show a warning notification
 */
export async function warning(
  title: string,
  body: string,
  options?: HelperOptions
): Promise<NotifyResult> {
  return notify(buildOptions(title, body, 'warning', options));
}

/**
 * Show an info notification
 */
export async function info(
  title: string,
  body: string,
  options?: HelperOptions
): Promise<NotifyResult> {
  return notify(buildOptions(title, body, 'info', options));
}

/**
 * Show a toast notification (always routes to toast, never desktop)
 * Use this for transient feedback like "Copied to clipboard"
 */
export function toast(
  title: string,
  body: string,
  options?: ToastOptions
): NotifyResult {
  logRoute('toast_direct', 'toast', { type: options?.type });
  return showToast(title, body, options);
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Notification service namespace object
 * Provides a convenient way to access all notification functions
 */
export const notifications = {
  notify,
  success,
  error,
  warning,
  info,
  toast,
  registerToastHandler,
  hasToastHandler,
  hasDesktopBridge,
  canUseDesktop,
  resetPermissionCache,
  setDebugLogging,
};

export default notifications;
