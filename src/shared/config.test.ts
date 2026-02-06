import test from 'node:test';
import assert from 'node:assert/strict';
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
