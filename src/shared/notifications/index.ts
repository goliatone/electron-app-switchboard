/**
 * Unified Notification Service
 *
 * @example Basic Usage
 * ```typescript
 * import { notifications } from './notifications';
 *
 * // Register toast handler at app startup
 * const unregister = notifications.registerToastHandler({
 *   show: (title, body, options) => {
 *     // Your toast implementation
 *     myToastLib.show({ title, message: body, type: options?.type });
 *   }
 * });
 *
 * // Show notifications
 * await notifications.success('Saved', 'Your changes have been saved');
 * await notifications.error('Error', 'Something went wrong');
 *
 * // Force toast route (for transient feedback)
 * notifications.toast('Copied', 'Text copied to clipboard');
 *
 * // Full control
 * const result = await notifications.notify({
 *   title: 'Update Available',
 *   body: 'A new version is ready to install',
 *   toast: { type: 'info', duration: 5000 },
 *   desktop: { urgency: 'normal' }
 * });
 * console.log(result.route); // 'desktop' or 'toast'
 * ```
 *
 * @example Toast Adapter Integration
 * ```typescript
 * import { createToastAdapter, bootstrapToastAdapter, FULL_CAPABILITIES } from './notifications';
 *
 * // At app startup - with hot-reload support
 * bootstrapToastAdapter(() => createToastAdapter({
 *   library: myToastLib,
 *   capabilities: FULL_CAPABILITIES,
 *   show: (lib, title, body, options) => {
 *     lib[options.type](body, {
 *       title,
 *       duration: options.duration ?? undefined,
 *       action: options.action ? {
 *         label: options.action.label,
 *         onClick: options.action.onClick
 *       } : undefined
 *     });
 *   }
 * }));
 * ```
 */

// Types
export type {
  NotifyOptions,
  NotifyResult,
  NotifyRoute,
  ToastHandler,
  ToastType,
  ToastOptions,
  ToastAction,
  DesktopOptions,
  HelperOptions,
} from './types';

// Service functions
export {
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
  notifications,
} from './notification-service';

// Toast adapter types and utilities
export type {
  ToastLibraryCapabilities,
  ToastAdapterConfig,
  NormalizedToastOptions,
} from './toast-adapter';

export {
  createToastAdapter,
  createConsoleToastAdapter,
  bootstrapToastAdapter,
  isAdapterRegistered,
  resetAdapterRegistration,
  normalizeToastOptions,
  mapTypeToMethod,
  mapTypeToClass,
  MINIMAL_CAPABILITIES,
  FULL_CAPABILITIES,
} from './toast-adapter';

// Compatibility layer for migration
export type {
  LegacyNotifyFn,
  LegacyToastFn,
  GlobalNotifyAPI,
} from './compat';

export {
  createGlobalNotifyAPI,
  wrapLegacyNotify,
  wrapLegacyToast,
  transient,
  detectObsoletePatterns,
} from './compat';

// Default export
export { default } from './notification-service';
