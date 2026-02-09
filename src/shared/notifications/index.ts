/**
 * Unified Notification Service
 *
 * @example
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

// Default export
export { default } from './notification-service';
