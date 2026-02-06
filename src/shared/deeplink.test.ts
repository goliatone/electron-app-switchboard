import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDeepLinkFromArgv, parseDeepLink } from './deeplink';

test('parseDeepLink parses supported action deep links', () => {
  const parsed = parseDeepLink('switchboard://reload', 'switchboard');
  assert.deepEqual(parsed, { kind: 'action', action: 'reload' });
});

test('parseDeepLink parses route deep links', () => {
  const parsed = parseDeepLink(
    'switchboard://route/admin/users?sort=desc#active',
    'switchboard'
  );
  assert.deepEqual(parsed, {
    kind: 'route',
    path: '/admin/users?sort=desc#active',
  });
});

test('parseDeepLink rejects unknown schemes and actions', () => {
  assert.equal(parseDeepLink('http://example.com', 'switchboard'), null);
  assert.equal(parseDeepLink('switchboard://dropdb', 'switchboard'), null);
});

test('extractDeepLinkFromArgv returns first matching deep link', () => {
  const link = extractDeepLinkFromArgv(
    ['--flag', 'switchboard://open', '--other'],
    'switchboard'
  );
  assert.equal(link, 'switchboard://open');
});
