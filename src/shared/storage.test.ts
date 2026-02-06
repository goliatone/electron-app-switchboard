import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_STORAGE_NAMESPACE,
  SECURE_STORAGE_NAMESPACE,
  getLocalStorageKey,
  getSecureStorageKey,
  isValidStorageKey,
  resolveStoredValue,
} from './storage';

test('storage key helpers namespace keys deterministically', () => {
  assert.equal(getLocalStorageKey('theme'), `${LOCAL_STORAGE_NAMESPACE}.theme`);
  assert.equal(getSecureStorageKey('token'), `${SECURE_STORAGE_NAMESPACE}.token`);
});

test('isValidStorageKey enforces safe key constraints', () => {
  assert.equal(isValidStorageKey('alpha.beta-123_456'), true);
  assert.equal(isValidStorageKey(''), false);
  assert.equal(isValidStorageKey('invalid key with spaces'), false);
  assert.equal(isValidStorageKey('../path-traversal'), false);
});

test('resolveStoredValue prefers namespaced values and preserves legacy values for migration', () => {
  const namespaced = resolveStoredValue('new-value', 'legacy-value');
  assert.deepEqual(namespaced, {
    value: 'new-value',
    shouldMigrateLegacyValue: false,
  });

  const legacy = resolveStoredValue(undefined, 'legacy-value');
  assert.deepEqual(legacy, {
    value: 'legacy-value',
    shouldMigrateLegacyValue: true,
  });

  const missing = resolveStoredValue(undefined, undefined);
  assert.deepEqual(missing, {
    value: null,
    shouldMigrateLegacyValue: false,
  });
});
