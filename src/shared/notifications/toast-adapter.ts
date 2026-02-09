/**
 * Toast Adapter
 *
 * Provides patterns and utilities for integrating toast notification libraries
 * with the unified notification service.
 *
 * This module includes:
 * - One-time registration guard
 * - Type mapping utilities
 * - Duration/action option handling
 * - Graceful degradation for unsupported features
 * - Cleanup patterns for tests/hot-reload
 */

import type { ToastHandler, ToastOptions, ToastType, ToastAction } from './types';
import { registerToastHandler, hasToastHandler } from './notification-service';

// ============================================================================
// Types for Toast Library Adapters
// ============================================================================

/**
 * Capabilities that a toast library may support
 */
export interface ToastLibraryCapabilities {
  /** Supports different visual types (success, error, warning, info) */
  supportsTypes: boolean;
  /** Supports custom duration */
  supportsDuration: boolean;
  /** Supports action buttons */
  supportsActions: boolean;
  /** Default duration in milliseconds (0 = persistent) */
  defaultDuration: number;
}

/**
 * Configuration for a toast library adapter
 */
export interface ToastAdapterConfig<TLibrary = unknown> {
  /** The toast library instance */
  library: TLibrary;
  /** Library capabilities */
  capabilities: ToastLibraryCapabilities;
  /** Show a toast using the library */
  show: (
    library: TLibrary,
    title: string,
    body: string,
    options: NormalizedToastOptions
  ) => void;
}

/**
 * Normalized toast options after capability-aware processing
 */
export interface NormalizedToastOptions {
  /** Toast type (always provided, may be ignored if unsupported) */
  type: ToastType;
  /** Duration in ms (null if not supported or default should be used) */
  duration: number | null;
  /** Action config (null if not supported) */
  action: ToastAction | null;
}

// ============================================================================
// N2.1 - One-Time Registration Guard
// ============================================================================

/** Track if adapter has been registered in current session */
let adapterRegistered = false;

/** Current cleanup function */
let currentCleanup: (() => void) | null = null;

/**
 * Check if an adapter is already registered
 */
export function isAdapterRegistered(): boolean {
  return adapterRegistered && hasToastHandler();
}

/**
 * Reset registration state (for tests/hot-reload)
 * Also calls any pending cleanup function
 */
export function resetAdapterRegistration(): void {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  adapterRegistered = false;
}

// ============================================================================
// N2.2 - N2.4 - Option Mapping Utilities
// ============================================================================

/**
 * Default capabilities for libraries with minimal feature support
 */
export const MINIMAL_CAPABILITIES: ToastLibraryCapabilities = {
  supportsTypes: false,
  supportsDuration: false,
  supportsActions: false,
  defaultDuration: 3000,
};

/**
 * Full capabilities for feature-rich toast libraries
 */
export const FULL_CAPABILITIES: ToastLibraryCapabilities = {
  supportsTypes: true,
  supportsDuration: true,
  supportsActions: true,
  defaultDuration: 5000,
};

/**
 * N2.5 - Normalize toast options based on library capabilities
 * Gracefully handles missing feature support by returning null for unsupported options
 */
export function normalizeToastOptions(
  options: ToastOptions | undefined,
  capabilities: ToastLibraryCapabilities
): NormalizedToastOptions {
  const type = options?.type ?? 'info';

  // N2.3 - Map duration with graceful degradation
  let duration: number | null = null;
  if (capabilities.supportsDuration) {
    if (options?.duration !== undefined) {
      duration = options.duration;
    }
    // If not specified, let the library use its default (pass null)
  }

  // N2.4 - Map action with graceful degradation
  let action: ToastAction | null = null;
  if (capabilities.supportsActions && options?.action) {
    action = options.action;
  }

  return { type, duration, action };
}

/**
 * N2.2 - Map toast type to common library method names
 * Useful for libraries that use method-per-type pattern (e.g., toast.success())
 */
export function mapTypeToMethod(type: ToastType): string {
  const methodMap: Record<ToastType, string> = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info',
  };
  return methodMap[type] ?? 'info';
}

/**
 * Map toast type to common CSS class names
 * Useful for libraries that use class-based styling
 */
export function mapTypeToClass(type: ToastType): string {
  const classMap: Record<ToastType, string> = {
    success: 'toast-success',
    error: 'toast-error',
    warning: 'toast-warning',
    info: 'toast-info',
  };
  return classMap[type] ?? 'toast-info';
}

// ============================================================================
// N2.1 & N2.6 - Adapter Factory with Registration Guard
// ============================================================================

/**
 * Create and register a toast handler from an adapter configuration
 *
 * Features:
 * - Prevents duplicate registration (N2.1)
 * - Normalizes options based on capabilities (N2.5)
 * - Returns cleanup function for tests/hot-reload (N2.6)
 *
 * @param config - Adapter configuration
 * @returns Cleanup function to unregister the adapter
 * @throws Error if adapter is already registered (unless force is true)
 */
export function createToastAdapter<TLibrary>(
  config: ToastAdapterConfig<TLibrary>,
  options?: { force?: boolean }
): () => void {
  // N2.1 - Prevent duplicate registration
  if (adapterRegistered && hasToastHandler()) {
    if (!options?.force) {
      console.warn(
        '[toast-adapter] Adapter already registered. Use { force: true } to replace.'
      );
      return () => {};
    }
    // Force replacement - clean up existing
    resetAdapterRegistration();
  }

  const { library, capabilities, show } = config;

  // Create the handler that will be registered
  const handler: ToastHandler = {
    show(title: string, body: string, toastOptions?: ToastOptions): void {
      // N2.5 - Normalize options with graceful degradation
      const normalized = normalizeToastOptions(toastOptions, capabilities);

      // Delegate to library-specific implementation
      show(library, title, body, normalized);
    },
  };

  // Register with the notification service
  const unregister = registerToastHandler(handler);

  // Track registration state
  adapterRegistered = true;

  // N2.6 - Create cleanup function
  const cleanup = () => {
    unregister();
    adapterRegistered = false;
    if (currentCleanup === cleanup) {
      currentCleanup = null;
    }
  };

  currentCleanup = cleanup;

  return cleanup;
}

// ============================================================================
// Reference Implementation - Console Toast Adapter
// ============================================================================

/**
 * A simple console-based toast adapter for development/testing
 * Demonstrates the adapter pattern without requiring a UI library
 */
export function createConsoleToastAdapter(): () => void {
  return createToastAdapter({
    library: console,
    capabilities: {
      supportsTypes: true,
      supportsDuration: false,
      supportsActions: false,
      defaultDuration: 0,
    },
    show: (lib, title, body, options) => {
      const prefix = `[TOAST:${options.type.toUpperCase()}]`;
      lib.log(`${prefix} ${title}: ${body}`);
    },
  });
}

// ============================================================================
// Bootstrap Helper
// ============================================================================

/**
 * Bootstrap state for hot-reload detection
 */
let bootstrapCount = 0;

/**
 * Bootstrap a toast adapter with hot-reload support
 *
 * Call this at app startup. Safe to call multiple times (idempotent).
 * Automatically handles cleanup on subsequent calls (hot-reload scenario).
 *
 * @param createAdapter - Factory function that creates the adapter
 * @returns Cleanup function
 */
export function bootstrapToastAdapter(
  createAdapter: () => () => void
): () => void {
  bootstrapCount++;
  const thisBootstrap = bootstrapCount;

  // Clean up any existing adapter from previous bootstrap
  if (currentCleanup) {
    console.debug('[toast-adapter] Hot-reload detected, cleaning up previous adapter');
    resetAdapterRegistration();
  }

  // Create new adapter
  const cleanup = createAdapter();

  // Return enhanced cleanup that checks for stale cleanups
  return () => {
    // Only clean up if this is still the current bootstrap
    if (thisBootstrap === bootstrapCount) {
      cleanup();
    }
  };
}
