/**
 * Shared storage key helpers and migration primitives.
 *
 * These helpers are intentionally pure so migration behavior can be tested
 * outside the Electron runtime.
 */

export const LOCAL_STORAGE_NAMESPACE = 'switchboard.local';
export const SECURE_STORAGE_NAMESPACE = 'switchboard.secure';
export const SECURE_KEY_INDEX = '__switchboard_secure_keys__';

export function isValidStorageKey(key: string): boolean {
  return key.length > 0 && key.length <= 256 && /^[a-zA-Z0-9_.-]+$/.test(key);
}

export function getLocalStorageKey(key: string): string {
  return `${LOCAL_STORAGE_NAMESPACE}.${key}`;
}

export function getSecureStorageKey(key: string): string {
  return `${SECURE_STORAGE_NAMESPACE}.${key}`;
}

export interface ResolvedStoredValue {
  value: string | null;
  shouldMigrateLegacyValue: boolean;
}

export function resolveStoredValue(
  namespacedValue: unknown,
  legacyValue: unknown
): ResolvedStoredValue {
  if (typeof namespacedValue === 'string') {
    return {
      value: namespacedValue,
      shouldMigrateLegacyValue: false,
    };
  }

  if (typeof legacyValue === 'string') {
    return {
      value: legacyValue,
      shouldMigrateLegacyValue: true,
    };
  }

  return {
    value: null,
    shouldMigrateLegacyValue: false,
  };
}
