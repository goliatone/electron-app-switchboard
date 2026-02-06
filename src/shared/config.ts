/**
 * Application configuration
 *
 * Configuration is loaded in the following order (later sources override earlier):
 * 1. Built-in defaults
 * 2. Config file (switchboard.config.json)
 * 3. Environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AppConfig {
  /** Primary URL to load in the renderer */
  appUrl: string;
  /** Trusted origins for navigation and IPC validation */
  trustedOrigins: string[];
  /** Allow HTTP for localhost in development */
  allowHttpLocalhost: boolean;
  /** Trust localhost/127.0.0.1 on any port (for local development) */
  trustLocalhostWildcard: boolean;
  /** Start app minimized to tray */
  startInTray: boolean;
  /** Minimize to tray instead of closing */
  minimizeToTray: boolean;
  /** Enable native notifications */
  enableNotifications: boolean;
  /** Log level for diagnostics */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Enable auto-updates (set false for enterprise deployments) */
  enableAutoUpdate: boolean;
  /** Auto-update channel */
  updateChannel: 'stable' | 'beta' | 'alpha';
  /** Auto-update check interval in hours (0 to disable periodic checks) */
  updateCheckInterval: number;
  /** Enable deep links (e.g., switchboard://) */
  enableDeepLinks: boolean;
  /** Deep link protocol scheme */
  deepLinkScheme: string;
}

/** Config file structure (all fields optional) */
export interface ConfigFile {
  appUrl?: string;
  trustedOrigins?: string[];
  allowHttpLocalhost?: boolean;
  trustLocalhostWildcard?: boolean;
  startInTray?: boolean;
  minimizeToTray?: boolean;
  enableNotifications?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  enableAutoUpdate?: boolean;
  updateChannel?: 'stable' | 'beta' | 'alpha';
  updateCheckInterval?: number;
  enableDeepLinks?: boolean;
  deepLinkScheme?: string;
}

// -----------------------------------------------------------------------------
// Config File Loading
// -----------------------------------------------------------------------------

/** Config file names to search for (in order of preference) */
const CONFIG_FILE_NAMES = [
  'switchboard.config.json',
  'config.json',
];

/**
 * Get possible config file paths in order of preference
 */
function getConfigPaths(): string[] {
  const paths: string[] = [];

  // 1. Current working directory
  for (const name of CONFIG_FILE_NAMES) {
    paths.push(path.join(process.cwd(), name));
  }

  // 2. App directory (where the executable is)
  try {
    const appPath = app.isPackaged
      ? path.dirname(app.getPath('exe'))
      : process.cwd();
    for (const name of CONFIG_FILE_NAMES) {
      const p = path.join(appPath, name);
      if (!paths.includes(p)) paths.push(p);
    }
  } catch {
    // app may not be ready yet
  }

  // 3. User data directory
  try {
    const userData = app.getPath('userData');
    for (const name of CONFIG_FILE_NAMES) {
      paths.push(path.join(userData, name));
    }
  } catch {
    // app may not be ready yet
  }

  // 4. Home directory
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    paths.push(path.join(home, '.switchboard.config.json'));
    paths.push(path.join(home, '.config', 'switchboard', 'config.json'));
  }

  return paths;
}

/**
 * Load and parse config file if it exists
 */
function loadConfigFile(): ConfigFile | null {
  // Check for explicit config file path via environment
  const explicitPath = process.env.SWITCHBOARD_CONFIG;
  if (explicitPath) {
    try {
      const content = fs.readFileSync(explicitPath, 'utf-8');
      console.log(`Loaded config from: ${explicitPath}`);
      return JSON.parse(content) as ConfigFile;
    } catch (err) {
      console.error(`Failed to load config from ${explicitPath}:`, err);
      return null;
    }
  }

  // Search standard locations
  for (const configPath of getConfigPaths()) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        console.log(`Loaded config from: ${configPath}`);
        return JSON.parse(content) as ConfigFile;
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Environment Variable Helpers
// -----------------------------------------------------------------------------

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function getEnvList(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function hasEnv(key: string): boolean {
  return process.env[key] !== undefined;
}

// -----------------------------------------------------------------------------
// Main Config Loading
// -----------------------------------------------------------------------------

/** Built-in defaults */
const DEFAULTS: Omit<AppConfig, 'trustedOrigins'> & { trustedOrigins?: string[] } = {
  appUrl: 'http://localhost:8080',
  trustedOrigins: undefined, // Computed from appUrl if not set
  allowHttpLocalhost: true,
  trustLocalhostWildcard: true,
  startInTray: false,
  minimizeToTray: true,
  enableNotifications: true,
  logLevel: 'info',
  enableAutoUpdate: true,
  updateChannel: 'stable',
  updateCheckInterval: 6,
  enableDeepLinks: true,
  deepLinkScheme: 'switchboard',
};

/**
 * Load configuration from defaults, config file, and environment variables
 *
 * Priority (highest to lowest):
 * 1. Environment variables
 * 2. Config file
 * 3. Built-in defaults
 */
export function loadConfig(): AppConfig {
  // Load config file (if exists)
  const fileConfig = loadConfigFile() ?? {};

  // Merge: defaults <- file <- env
  const rawAppUrl =
    hasEnv('APP_URL') ? getEnv('APP_URL', '') :
    fileConfig.appUrl ?? DEFAULTS.appUrl;

  let appUrl = rawAppUrl;
  try {
    const parsed = new URL(rawAppUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported protocol ${parsed.protocol}`);
    }
    appUrl = parsed.toString();
  } catch (error) {
    appUrl = DEFAULTS.appUrl;
    console.warn(
      `Invalid APP_URL "${rawAppUrl}". Falling back to "${appUrl}".`,
      error instanceof Error ? error.message : error
    );
  }

  // Compute default trusted origins from appUrl
  const appOrigin = new URL(appUrl).origin;
  const defaultTrustedOrigins = [appOrigin];

  const trustedOrigins =
    hasEnv('TRUSTED_ORIGINS') ? getEnvList('TRUSTED_ORIGINS', []) :
    fileConfig.trustedOrigins ?? defaultTrustedOrigins;

  const config: AppConfig = {
    appUrl,
    trustedOrigins,

    allowHttpLocalhost:
      hasEnv('ALLOW_HTTP_LOCALHOST') ? getEnvBool('ALLOW_HTTP_LOCALHOST', true) :
      fileConfig.allowHttpLocalhost ?? DEFAULTS.allowHttpLocalhost,

    trustLocalhostWildcard:
      hasEnv('TRUST_LOCALHOST_WILDCARD') ? getEnvBool('TRUST_LOCALHOST_WILDCARD', true) :
      fileConfig.trustLocalhostWildcard ?? DEFAULTS.trustLocalhostWildcard,

    startInTray:
      hasEnv('START_IN_TRAY') ? getEnvBool('START_IN_TRAY', false) :
      fileConfig.startInTray ?? DEFAULTS.startInTray,

    minimizeToTray:
      hasEnv('MINIMIZE_TO_TRAY') ? getEnvBool('MINIMIZE_TO_TRAY', true) :
      fileConfig.minimizeToTray ?? DEFAULTS.minimizeToTray,

    enableNotifications:
      hasEnv('ENABLE_NOTIFICATIONS') ? getEnvBool('ENABLE_NOTIFICATIONS', true) :
      fileConfig.enableNotifications ?? DEFAULTS.enableNotifications,

    logLevel:
      hasEnv('LOG_LEVEL') ? getEnv('LOG_LEVEL', 'info') as AppConfig['logLevel'] :
      fileConfig.logLevel ?? DEFAULTS.logLevel,

    enableAutoUpdate:
      hasEnv('ENABLE_AUTO_UPDATE') ? getEnvBool('ENABLE_AUTO_UPDATE', true) :
      fileConfig.enableAutoUpdate ?? DEFAULTS.enableAutoUpdate,

    updateChannel:
      hasEnv('UPDATE_CHANNEL') ? getEnv('UPDATE_CHANNEL', 'stable') as AppConfig['updateChannel'] :
      fileConfig.updateChannel ?? DEFAULTS.updateChannel,

    updateCheckInterval:
      hasEnv('UPDATE_CHECK_INTERVAL') ? parseInt(getEnv('UPDATE_CHECK_INTERVAL', '6'), 10) :
      fileConfig.updateCheckInterval ?? DEFAULTS.updateCheckInterval,

    enableDeepLinks:
      hasEnv('ENABLE_DEEP_LINKS') ? getEnvBool('ENABLE_DEEP_LINKS', true) :
      fileConfig.enableDeepLinks ?? DEFAULTS.enableDeepLinks,

    deepLinkScheme:
      hasEnv('DEEP_LINK_SCHEME') ? getEnv('DEEP_LINK_SCHEME', 'switchboard') :
      fileConfig.deepLinkScheme ?? DEFAULTS.deepLinkScheme,
  };

  return config;
}

/**
 * Validate that a URL origin is trusted
 */
export function isTrustedOrigin(url: string, config: AppConfig): boolean {
  try {
    const origin = new URL(url).origin;

    // Check explicit trusted origins
    if (config.trustedOrigins.includes(origin)) {
      return true;
    }

    // Allow wildcard localhost trust in development if configured.
    if (config.allowHttpLocalhost && config.trustLocalhostWildcard) {
      const parsedUrl = new URL(url);
      if (
        parsedUrl.hostname === 'localhost' ||
        parsedUrl.hostname === '127.0.0.1'
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get the path where a user config file should be created
 */
export function getDefaultConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'switchboard.config.json');
  } catch {
    return path.join(process.cwd(), 'switchboard.config.json');
  }
}

/**
 * Write a config file with the given values
 */
export function writeConfigFile(config: Partial<ConfigFile>, filePath?: string): void {
  const targetPath = filePath ?? getDefaultConfigPath();
  const dir = path.dirname(targetPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Config written to: ${targetPath}`);
}
