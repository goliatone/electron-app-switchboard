#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
  const absolutePath = path.join(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, 'utf-8');
}

function runCheck(state, description, condition, context) {
  if (condition) {
    state.passed.push(description);
    return;
  }

  state.failed.push({ description, context });
}

function contains(text, pattern) {
  if (typeof pattern === 'string') return text.includes(pattern);
  return pattern.test(text);
}

function parseBuilderConfig(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Unable to parse electron-builder.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  const state = { passed: [], failed: [] };

  const mainSource = readFile('src/main/index.ts');
  const preloadSource = readFile('src/preload/index.ts');
  const typesSource = readFile('src/shared/types.ts');
  const storageTestSource = readFile('src/shared/storage.test.ts');
  const tskSource = readFile('DEBUG_REMOTE_TSK.md');
  const workflowSource = readFile('.github/workflows/release-macos.yml');
  const builderConfig = parseBuilderConfig(readFile('electron-builder.json'));

  // QA-1: Security verification
  runCheck(
    state,
    'BrowserWindow sets contextIsolation=true',
    contains(mainSource, /contextIsolation:\s*true/),
    'src/main/index.ts webPreferences'
  );
  runCheck(
    state,
    'BrowserWindow sets sandbox=true',
    contains(mainSource, /sandbox:\s*true/),
    'src/main/index.ts webPreferences'
  );
  runCheck(
    state,
    'BrowserWindow sets nodeIntegration=false',
    contains(mainSource, /nodeIntegration:\s*false/),
    'src/main/index.ts webPreferences'
  );
  runCheck(
    state,
    'Navigation blocks untrusted origins with isTrustedOrigin',
    contains(mainSource, /will-navigate[\s\S]*?if\s*\(!isTrustedOrigin\(url,\s*config\)\)/),
    'src/main/index.ts will-navigate handler'
  );
  runCheck(
    state,
    'IPC sender validation checks trusted origin',
    contains(mainSource, /const validateSender[\s\S]*?isTrustedOrigin\(senderUrl,\s*config\)/),
    'src/main/index.ts setupIpcHandlers.validateSender'
  );
  runCheck(
    state,
    'Renderer bridge is exposed only via contextBridge.exposeInMainWorld',
    contains(preloadSource, 'contextBridge.exposeInMainWorld(\'electronBridge\', electronBridge);'),
    'src/preload/index.ts bridge exposure'
  );
  runCheck(
    state,
    'Bridge types do not expose generic Node primitives',
    !contains(typesSource, /require\s*:\s*|process\s*:\s*|child_process/),
    'src/shared/types.ts ElectronBridge'
  );

  // QA-2: Functional verification
  runCheck(
    state,
    'Window lifecycle handlers include minimize/hide/show IPC methods',
    contains(mainSource, /APP_MINIMIZE[\s\S]*APP_HIDE[\s\S]*APP_SHOW/),
    'src/main/index.ts app IPC handlers'
  );
  runCheck(
    state,
    'Fallback UI includes retry/settings/quit actions',
    contains(mainSource, /Retry Connection[\s\S]*Settings[\s\S]*Quit/),
    'src/main/index.ts loadFallbackPage'
  );
  runCheck(
    state,
    'Tray menu includes open/reload/quit actions',
    contains(mainSource, /Open Switchboard[\s\S]*Reload[\s\S]*Quit/),
    'src/main/index.ts updateTrayMenu'
  );
  runCheck(
    state,
    'Tray status supports connected/degraded/disconnected',
    contains(mainSource, /type TrayStatus = 'connected' \| 'degraded' \| 'disconnected'/) ||
      contains(typesSource, /export type TrayStatus = 'connected' \| 'degraded' \| 'disconnected'/),
    'src/shared/types.ts TrayStatus'
  );
  runCheck(
    state,
    'Notification trigger and click focus handlers are implemented',
    contains(mainSource, /NOTIFICATION_SHOW[\s\S]*notification\.on\('click'/),
    'src/main/index.ts notification IPC handler'
  );
  runCheck(
    state,
    'Storage and secureStorage IPC handlers cover get/set/remove/clear',
    contains(mainSource, /STORAGE_GET[\s\S]*STORAGE_SET[\s\S]*STORAGE_REMOVE[\s\S]*STORAGE_CLEAR/) &&
      contains(mainSource, /SECURE_STORAGE_GET[\s\S]*SECURE_STORAGE_SET[\s\S]*SECURE_STORAGE_REMOVE[\s\S]*SECURE_STORAGE_CLEAR/),
    'src/main/index.ts storage IPC handlers'
  );
  runCheck(
    state,
    'Deep-link handling is validated and routed through parseDeepLink',
    contains(mainSource, /parseDeepLink\(rawUrl,\s*config\.deepLinkScheme\)/),
    'src/main/index.ts handleDeepLink'
  );

  // QA-3: Release verification preconditions
  const macTargets = (builderConfig.mac && Array.isArray(builderConfig.mac.target))
    ? builderConfig.mac.target
    : [];
  runCheck(
    state,
    'electron-builder mac targets include dmg and zip',
    macTargets.includes('dmg') && macTargets.includes('zip'),
    'electron-builder.json mac.target'
  );
  runCheck(
    state,
    'Release workflow packages and publishes macOS artifacts',
    contains(workflowSource, /electron-builder --mac[\s\S]*--publish always/),
    '.github/workflows/release-macos.yml'
  );
  runCheck(
    state,
    'Release workflow validates signing/notarization secrets',
    contains(workflowSource, /Validate signing and notarization secrets/),
    '.github/workflows/release-macos.yml'
  );
  runCheck(
    state,
    'Diagnostics copy/export IPC channels are present',
    contains(mainSource, /DIAGNOSTICS_COPY[\s\S]*DIAGNOSTICS_EXPORT[\s\S]*DIAGNOSTICS_GET_LOG_PATH/),
    'src/main/index.ts diagnostics IPC handlers'
  );
  runCheck(
    state,
    'Upgrade persistence verification tests exist for storage migration',
    contains(storageTestSource, 'resolveStoredValue prefers namespaced values and preserves legacy values for migration'),
    'src/shared/storage.test.ts'
  );

  // Sanity check: cross-phase section exists and remains actionable.
  runCheck(
    state,
    'Cross-phase QA section exists in task document',
    contains(tskSource, '## Cross-Phase QA'),
    'DEBUG_REMOTE_TSK.md'
  );

  if (state.failed.length > 0) {
    console.error('Cross-phase QA verification failed.');
    for (const failure of state.failed) {
      console.error(`- ${failure.description}`);
      if (failure.context) console.error(`  context: ${failure.context}`);
    }
    process.exit(1);
  }

  console.log(`Cross-phase QA verification passed (${state.passed.length} checks).`);
}

main();
