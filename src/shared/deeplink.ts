export type DeepLinkAction = 'open' | 'show' | 'reload' | 'quit' | 'settings';

export type DeepLinkCommand =
  | { kind: 'action'; action: DeepLinkAction }
  | { kind: 'route'; path: string };

function normalizeScheme(scheme: string): string {
  return scheme.replace(/:$/, '').toLowerCase();
}

/**
 * Parse and validate supported deep links.
 *
 * Supported patterns:
 * - switchboard://open
 * - switchboard://show
 * - switchboard://reload
 * - switchboard://settings
 * - switchboard://quit
 * - switchboard://route/<path>?query#hash
 */
export function parseDeepLink(url: string, scheme: string): DeepLinkCommand | null {
  try {
    const parsed = new URL(url);
    const expectedProtocol = `${normalizeScheme(scheme)}:`;
    if (parsed.protocol.toLowerCase() !== expectedProtocol) return null;

    const action = parsed.hostname.toLowerCase();
    if (
      action === 'open' ||
      action === 'show' ||
      action === 'reload' ||
      action === 'quit' ||
      action === 'settings'
    ) {
      return { kind: 'action', action };
    }

    if (action === 'route') {
      // Keep routing constrained to app-relative URLs.
      const path = `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
      if (!path.startsWith('/')) return null;
      return { kind: 'route', path };
    }

    return null;
  } catch {
    return null;
  }
}

export function extractDeepLinkFromArgv(argv: string[], scheme: string): string | null {
  const prefix = `${normalizeScheme(scheme)}://`;
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(prefix)) {
      return arg;
    }
  }
  return null;
}
