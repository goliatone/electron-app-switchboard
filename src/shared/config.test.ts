import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, isTrustedOrigin } from './config';

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withTempConfigFile<T>(config: unknown, run: (configPath: string, configDir: string) => T): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-config-'));
  const configPath = path.join(tempDir, 'switchboard.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

  try {
    return run(configPath, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('invalid APP_URL falls back to default localhost URL', () => {
  withEnv(
    {
      APP_URL: 'not-a-url',
      TRUSTED_ORIGINS: undefined,
      TRUST_LOCALHOST_WILDCARD: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.appUrl, 'http://localhost:8080');
      assert.deepEqual(config.trustedOrigins, ['http://localhost:8080']);
    }
  );
});

test('wildcard localhost trust is configurable', () => {
  withEnv(
    {
      APP_URL: 'https://debug.example.com',
      TRUSTED_ORIGINS: 'https://debug.example.com',
      ALLOW_HTTP_LOCALHOST: 'true',
      TRUST_LOCALHOST_WILDCARD: 'true',
    },
    () => {
      const config = loadConfig();
      assert.equal(isTrustedOrigin('http://localhost:9999', config), true);
      assert.equal(isTrustedOrigin('http://127.0.0.1:3000', config), true);
    }
  );

  withEnv(
    {
      APP_URL: 'https://debug.example.com',
      TRUSTED_ORIGINS: 'https://debug.example.com,http://localhost:3000',
      ALLOW_HTTP_LOCALHOST: 'true',
      TRUST_LOCALHOST_WILDCARD: 'false',
    },
    () => {
      const config = loadConfig();
      assert.equal(isTrustedOrigin('http://localhost:9999', config), false);
      assert.equal(isTrustedOrigin('http://localhost:3000', config), true);
    }
  );
});

test('splash enabled env override and configDirectory are applied', () => {
  withTempConfigFile(
    {
      appUrl: 'https://debug.example.com',
      trustedOrigins: ['https://debug.example.com'],
      splash: {
        enabled: false,
        appName: 'Config Splash',
      },
    },
    (configPath, configDir) => {
      withEnv(
        {
          SWITCHBOARD_CONFIG: configPath,
          SPLASH_ENABLED: 'true',
          APP_URL: undefined,
          TRUSTED_ORIGINS: undefined,
        },
        () => {
          const config = loadConfig();
          assert.equal(config.configDirectory, configDir);
          assert.equal(config.splash.enabled, true);
          assert.equal(config.splash.appName, 'Config Splash');
        }
      );
    }
  );
});

test('invalid splash config values are sanitized to defaults', () => {
  withTempConfigFile(
    {
      appUrl: 'https://debug.example.com',
      trustedOrigins: ['https://debug.example.com'],
      splash: {
        enabled: 'not-bool',
        customHtmlPath: '\u0000bad-path',
        logoPath: '   ',
        logoWidth: -12,
        logoHeight: 99999,
        backgroundColor: 'red; background-image:url(http://bad)',
        textColor: '#GGGGGG',
        textColorSecondary: 123,
        accentColor: 'rgba(79, 70, 229, 0.7)',
        loadingText: '',
        appName: '   ',
        showVersion: 'not-bool',
      },
    },
    (configPath) => {
      withEnv(
        {
          SWITCHBOARD_CONFIG: configPath,
          SPLASH_ENABLED: undefined,
          APP_URL: undefined,
          TRUSTED_ORIGINS: undefined,
        },
        () => {
          const config = loadConfig();
          assert.equal(config.splash.enabled, true);
          assert.equal(config.splash.customHtmlPath, undefined);
          assert.equal(config.splash.logoPath, undefined);
          assert.equal(config.splash.logoWidth, 80);
          assert.equal(config.splash.logoHeight, undefined);
          assert.equal(config.splash.backgroundColor, '#1a1a2e');
          assert.equal(config.splash.textColor, '#e8e8e8');
          assert.equal(config.splash.textColorSecondary, '#a0a0a0');
          assert.equal(config.splash.accentColor, 'rgba(79, 70, 229, 0.7)');
          assert.equal(config.splash.loadingText, 'Connecting...');
          assert.equal(config.splash.appName, 'Switchboard');
          assert.equal(config.splash.showVersion, true);
        }
      );
    }
  );
});
