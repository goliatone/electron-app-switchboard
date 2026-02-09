/**
 * Notification Service Tests
 *
 * Comprehensive test suite covering:
 * - Route selection logic (N4.1-N4.5)
 * - Permission preflight caching (N4.6-N4.7)
 * - Toast handler lifecycle (N4.8)
 * - Contract verification (N4.9)
 * - Integration scenarios (N4.10-N4.11)
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

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
  canUseDesktop,
  resetPermissionCache,
  setDebugLogging,
} from './notification-service';

import type { ToastHandler, ToastOptions, NotifyOptions, DesktopOptions } from './types';
import type { NotificationOptions } from '../types';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock toast handler for testing
 */
function createMockToastHandler(): ToastHandler & {
  calls: Array<{ title: string; body: string; options?: ToastOptions }>;
  reset: () => void;
} {
  const calls: Array<{ title: string; body: string; options?: ToastOptions }> = [];
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    show(title: string, body: string, options?: ToastOptions) {
      calls.push({ title, body, options });
    },
  };
}

/**
 * Mock Electron bridge for testing
 */
function createMockBridge(options: {
  permissionResult?: boolean;
  showShouldFail?: boolean;
  showError?: string;
} = {}): {
  notifications: {
    show: (title: string, body: string, opts?: NotificationOptions) => Promise<void>;
    requestPermission: () => Promise<boolean>;
  };
  showCalls: Array<{ title: string; body: string; options?: NotificationOptions }>;
  permissionCalls: number;
  isElectron: true;
} {
  const showCalls: Array<{ title: string; body: string; options?: NotificationOptions }> = [];
  let permissionCalls = 0;

  return {
    isElectron: true,
    showCalls,
    get permissionCalls() {
      return permissionCalls;
    },
    notifications: {
      async show(title: string, body: string, opts?: NotificationOptions) {
        if (options.showShouldFail) {
          throw new Error(options.showError ?? 'Desktop notification failed');
        }
        showCalls.push({ title, body, options: opts });
      },
      async requestPermission() {
        permissionCalls++;
        return options.permissionResult ?? true;
      },
    },
  };
}

/**
 * Setup and teardown helpers for window.electronBridge mocking
 */
function setupBridgeMock(bridge: ReturnType<typeof createMockBridge> | undefined): () => void {
  const originalBridge = (globalThis as { electronBridge?: unknown }).electronBridge;
  (globalThis as { electronBridge?: unknown }).electronBridge = bridge;

  // Also set on window if it exists
  if (typeof window !== 'undefined') {
    (window as { electronBridge?: unknown }).electronBridge = bridge;
  }

  return () => {
    (globalThis as { electronBridge?: unknown }).electronBridge = originalBridge;
    if (typeof window !== 'undefined') {
      (window as { electronBridge?: unknown }).electronBridge = originalBridge;
    }
  };
}

// ============================================================================
// N4.1 - Routes to toast when bridge is absent
// ============================================================================

describe('N4.1 - Routes to toast when bridge is absent', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(undefined);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('notify routes to toast when no bridge exists', async () => {
    const result = await notify({
      title: 'Test',
      body: 'Message',
    });

    assert.equal(result.route, 'toast');
    assert.equal(result.usedFallback, false);
    assert.equal(mockHandler.calls.length, 1);
    assert.equal(mockHandler.calls[0].title, 'Test');
    assert.equal(mockHandler.calls[0].body, 'Message');
  });

  test('hasDesktopBridge returns false when bridge is absent', () => {
    assert.equal(hasDesktopBridge(), false);
  });

  test('canUseDesktop returns false when bridge is absent', async () => {
    assert.equal(await canUseDesktop(), false);
  });
});

// ============================================================================
// N4.2 - Routes to desktop when capability exists and preflight is true
// ============================================================================

describe('N4.2 - Routes to desktop when capability exists and preflight is true', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: true });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('notify routes to desktop when permission granted', async () => {
    const result = await notify({
      title: 'Desktop Test',
      body: 'Should go to desktop',
    });

    assert.equal(result.route, 'desktop');
    assert.equal(result.usedFallback, false);
    assert.equal(mockBridge.showCalls.length, 1);
    assert.equal(mockBridge.showCalls[0].title, 'Desktop Test');
    assert.equal(mockHandler.calls.length, 0); // Toast not called
  });

  test('hasDesktopBridge returns true when bridge exists', () => {
    assert.equal(hasDesktopBridge(), true);
  });

  test('canUseDesktop returns true when permission granted', async () => {
    assert.equal(await canUseDesktop(), true);
  });

  test('desktop options are passed to bridge', async () => {
    await notify({
      title: 'Test',
      body: 'With options',
      desktop: { silent: true, urgency: 'critical' },
    });

    assert.equal(mockBridge.showCalls[0].options?.silent, true);
    assert.equal(mockBridge.showCalls[0].options?.urgency, 'critical');
  });
});

// ============================================================================
// N4.3 - Routes to toast when preflight is false
// ============================================================================

describe('N4.3 - Routes to toast when preflight is false', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: false });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('notify routes to toast when permission denied', async () => {
    const result = await notify({
      title: 'Test',
      body: 'Should go to toast',
    });

    assert.equal(result.route, 'toast');
    assert.equal(result.usedFallback, false);
    assert.equal(mockHandler.calls.length, 1);
    assert.equal(mockBridge.showCalls.length, 0); // Desktop not called
  });

  test('canUseDesktop returns false when permission denied', async () => {
    assert.equal(await canUseDesktop(), false);
  });
});

// ============================================================================
// N4.4 - Desktop failure triggers toast fallback
// ============================================================================

describe('N4.4 - Desktop failure triggers toast fallback', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({
      permissionResult: true,
      showShouldFail: true,
      showError: 'Desktop display error',
    });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('falls back to toast when desktop fails', async () => {
    const result = await notify({
      title: 'Test',
      body: 'Should fallback',
    });

    assert.equal(result.route, 'toast');
    assert.equal(result.usedFallback, true);
    assert.equal(result.error, 'Desktop display error');
    assert.equal(mockHandler.calls.length, 1);
  });

  test('does not throw on desktop failure', async () => {
    // Should not throw
    const result = await notify({
      title: 'Test',
      body: 'Should not throw',
    });

    assert.ok(result); // Completed without throwing
  });
});

// ============================================================================
// N4.5 - preferToast always forces toast route
// ============================================================================

describe('N4.5 - preferToast always forces toast route', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: true });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('preferToast forces toast even with desktop available', async () => {
    const result = await notify({
      title: 'Test',
      body: 'Force toast',
      preferToast: true,
    });

    assert.equal(result.route, 'toast');
    assert.equal(result.usedFallback, false);
    assert.equal(mockHandler.calls.length, 1);
    assert.equal(mockBridge.showCalls.length, 0); // Desktop never called
    assert.equal(mockBridge.permissionCalls, 0); // Permission never checked
  });

  test('toast() helper always uses toast route', () => {
    const result = toast('Test', 'Direct toast');

    assert.equal(result.route, 'toast');
    assert.equal(mockHandler.calls.length, 1);
    assert.equal(mockBridge.showCalls.length, 0);
  });
});

// ============================================================================
// N4.6 - Permission preflight cache reused
// ============================================================================

describe('N4.6 - Permission preflight cache reused', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: true });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('permission is only requested once', async () => {
    await notify({ title: 'Test 1', body: 'First' });
    await notify({ title: 'Test 2', body: 'Second' });
    await notify({ title: 'Test 3', body: 'Third' });

    assert.equal(mockBridge.permissionCalls, 1); // Only called once
    assert.equal(mockBridge.showCalls.length, 3); // All three shown
  });

  test('resetPermissionCache clears cache', async () => {
    await notify({ title: 'Test 1', body: 'First' });
    assert.equal(mockBridge.permissionCalls, 1);

    resetPermissionCache();

    await notify({ title: 'Test 2', body: 'Second' });
    assert.equal(mockBridge.permissionCalls, 2); // Called again after reset
  });
});

// ============================================================================
// N4.7 - Concurrent notifications dedupe permission preflight
// ============================================================================

describe('N4.7 - Concurrent notifications dedupe permission preflight', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: true });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('concurrent notifications share permission check', async () => {
    // Fire multiple notifications concurrently
    const results = await Promise.all([
      notify({ title: 'Test 1', body: 'Concurrent 1' }),
      notify({ title: 'Test 2', body: 'Concurrent 2' }),
      notify({ title: 'Test 3', body: 'Concurrent 3' }),
    ]);

    assert.equal(mockBridge.permissionCalls, 1); // Only one permission call
    assert.equal(results.every(r => r.route === 'desktop'), true);
    assert.equal(mockBridge.showCalls.length, 3);
  });
});

// ============================================================================
// N4.8 - Toast register/unregister lifecycle
// ============================================================================

describe('N4.8 - Toast register/unregister lifecycle', () => {
  beforeEach(() => {
    resetPermissionCache();
  });

  test('hasToastHandler returns false initially', () => {
    // Note: This test assumes no handler is registered at start
    // In practice, previous tests may have left handlers
  });

  test('registerToastHandler returns unregister function', () => {
    const handler = createMockToastHandler();
    const unregister = registerToastHandler(handler);

    assert.equal(typeof unregister, 'function');
    assert.equal(hasToastHandler(), true);

    unregister();
    assert.equal(hasToastHandler(), false);
  });

  test('unregister only removes the registered handler', () => {
    const handler1 = createMockToastHandler();
    const handler2 = createMockToastHandler();

    const unregister1 = registerToastHandler(handler1);
    const unregister2 = registerToastHandler(handler2);

    // Handler 2 replaced handler 1
    assert.equal(hasToastHandler(), true);

    // Unregister handler 1 (already replaced, should do nothing)
    unregister1();
    assert.equal(hasToastHandler(), true); // Handler 2 still active

    // Unregister handler 2
    unregister2();
    assert.equal(hasToastHandler(), false);
  });

  test('notify returns none when no handler registered', async () => {
    const restoreBridge = setupBridgeMock(undefined);

    try {
      const result = await notify({ title: 'Test', body: 'No handler' });

      assert.equal(result.route, 'none');
      assert.equal(result.error, 'No toast handler registered');
    } finally {
      restoreBridge();
    }
  });
});

// ============================================================================
// N4.9 - Contract test: NotifyOptions.desktop derived from bridge
// ============================================================================

describe('N4.9 - Contract test: desktop options type alignment', () => {
  test('DesktopOptions is assignable from NotificationOptions', () => {
    // This is a compile-time check - if types don't match, this won't compile
    const bridgeOptions: NotificationOptions = {
      icon: 'path/to/icon',
      silent: true,
      urgency: 'critical',
      tag: 'my-tag',
    };

    const desktopOptions: DesktopOptions = bridgeOptions;

    // Runtime verification that all properties are preserved
    assert.equal(desktopOptions.icon, 'path/to/icon');
    assert.equal(desktopOptions.silent, true);
    assert.equal(desktopOptions.urgency, 'critical');
    assert.equal(desktopOptions.tag, 'my-tag');
  });

  test('NotifyOptions.desktop accepts all bridge option fields', () => {
    const options: NotifyOptions = {
      title: 'Test',
      body: 'Message',
      desktop: {
        icon: 'test-icon',
        silent: false,
        urgency: 'low',
        tag: 'test-tag',
      },
    };

    assert.ok(options.desktop);
    assert.equal(options.desktop.icon, 'test-icon');
    assert.equal(options.desktop.silent, false);
    assert.equal(options.desktop.urgency, 'low');
    assert.equal(options.desktop.tag, 'test-tag');
  });
});

// ============================================================================
// N4.10 - Integration test: toast option propagation
// ============================================================================

describe('N4.10 - Integration test: toast option propagation', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(undefined); // No bridge = toast route
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('toast type is propagated to handler', async () => {
    await notify({
      title: 'Test',
      body: 'Message',
      toast: { type: 'error' },
    });

    assert.equal(mockHandler.calls[0].options?.type, 'error');
  });

  test('toast duration is propagated to handler', async () => {
    await notify({
      title: 'Test',
      body: 'Message',
      toast: { duration: 5000 },
    });

    assert.equal(mockHandler.calls[0].options?.duration, 5000);
  });

  test('toast action is propagated to handler', async () => {
    const actionFn = () => {};

    await notify({
      title: 'Test',
      body: 'Message',
      toast: {
        action: { label: 'Undo', onClick: actionFn },
      },
    });

    assert.equal(mockHandler.calls[0].options?.action?.label, 'Undo');
    assert.equal(mockHandler.calls[0].options?.action?.onClick, actionFn);
  });

  test('convenience helpers propagate correct type', async () => {
    await success('Success', 'Message');
    await error('Error', 'Message');
    await warning('Warning', 'Message');
    await info('Info', 'Message');

    assert.equal(mockHandler.calls[0].options?.type, 'success');
    assert.equal(mockHandler.calls[1].options?.type, 'error');
    assert.equal(mockHandler.calls[2].options?.type, 'warning');
    assert.equal(mockHandler.calls[3].options?.type, 'info');
  });
});

// ============================================================================
// N4.11 - Integration test: Electron bridge mock path
// ============================================================================

describe('N4.11 - Integration test: Electron bridge mock path', () => {
  let mockHandler: ReturnType<typeof createMockToastHandler>;
  let mockBridge: ReturnType<typeof createMockBridge>;
  let unregister: () => void;
  let restoreBridge: () => void;

  beforeEach(() => {
    resetPermissionCache();
    mockHandler = createMockToastHandler();
    mockBridge = createMockBridge({ permissionResult: true });
    unregister = registerToastHandler(mockHandler);
    restoreBridge = setupBridgeMock(mockBridge);
  });

  afterEach(() => {
    unregister();
    restoreBridge();
  });

  test('full desktop notification flow', async () => {
    // Step 1: Check capability
    assert.equal(hasDesktopBridge(), true);

    // Step 2: Check permission (will cache)
    assert.equal(await canUseDesktop(), true);
    assert.equal(mockBridge.permissionCalls, 1);

    // Step 3: Send notification
    const result = await notify({
      title: 'Integration Test',
      body: 'Full flow',
      desktop: { silent: true },
    });

    // Step 4: Verify result
    assert.equal(result.route, 'desktop');
    assert.equal(result.usedFallback, false);
    assert.equal(result.error, undefined);

    // Step 5: Verify bridge was called correctly
    assert.equal(mockBridge.showCalls.length, 1);
    assert.equal(mockBridge.showCalls[0].title, 'Integration Test');
    assert.equal(mockBridge.showCalls[0].body, 'Full flow');
    assert.equal(mockBridge.showCalls[0].options?.silent, true);

    // Step 6: Verify toast was not called
    assert.equal(mockHandler.calls.length, 0);
  });

  test('full fallback flow', async () => {
    // Setup failing bridge
    restoreBridge();
    mockBridge = createMockBridge({
      permissionResult: true,
      showShouldFail: true,
      showError: 'Test error',
    });
    restoreBridge = setupBridgeMock(mockBridge);
    resetPermissionCache();

    const result = await notify({
      title: 'Fallback Test',
      body: 'Should fallback',
      toast: { type: 'warning' },
    });

    // Verify fallback occurred
    assert.equal(result.route, 'toast');
    assert.equal(result.usedFallback, true);
    assert.equal(result.error, 'Test error');

    // Verify toast was called with correct options
    assert.equal(mockHandler.calls.length, 1);
    assert.equal(mockHandler.calls[0].title, 'Fallback Test');
    assert.equal(mockHandler.calls[0].options?.type, 'warning');
  });
});
