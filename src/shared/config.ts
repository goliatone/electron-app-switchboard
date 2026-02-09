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
  /** Directory containing the loaded config file (if any) */
  configDirectory?: string;
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
  /** Splash screen configuration */
  splash: SplashConfig;
}

/** Splash screen configuration */
export interface SplashConfig {
  /** Enable splash screen while loading (default: true) */
  enabled: boolean;
  /** Path to custom splash HTML file (overrides generated splash) */
  customHtmlPath?: string;
  /** Path to logo image (PNG/SVG, relative to app or absolute) */
  logoPath?: string;
  /** Logo width in pixels (default: 80) */
  logoWidth: number;
  /** Logo height in pixels (default: auto) */
  logoHeight?: number;
  /** Background color (hex or CSS color, default: #1a1a2e) */
  backgroundColor: string;
  /** Text color (default: #e8e8e8) */
  textColor: string;
  /** Secondary/muted text color (default: #a0a0a0) */
  textColorSecondary: string;
  /** Accent/spinner color (default: #4f46e5) */
  accentColor: string;
  /** Loading text (default: "Connecting...") */
  loadingText: string;
  /** App name displayed on splash (default: "Switchboard") */
  appName: string;
  /** Show app version on splash (default: true) */
  showVersion: boolean;
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
  splash?: Partial<SplashConfig>;
}

interface LoadedConfigFile {
  config: ConfigFile;
  path: string;
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
function loadConfigFile(): LoadedConfigFile | null {
  // Check for explicit config file path via environment
  const explicitPath = process.env.SWITCHBOARD_CONFIG;
  if (explicitPath) {
    try {
      const content = fs.readFileSync(explicitPath, 'utf-8');
      console.log(`Loaded config from: ${explicitPath}`);
      return {
        config: JSON.parse(content) as ConfigFile,
        path: explicitPath,
      };
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
        return {
          config: JSON.parse(content) as ConfigFile,
          path: configPath,
        };
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

function parseSplashBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseSplashPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 1024 || trimmed.includes('\0')) {
    return undefined;
  }

  return trimmed;
}

function parseSplashString(
  value: unknown,
  fallback: string,
  field: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    console.warn(`Invalid splash.${field}. Falling back to default.`);
    return fallback;
  }

  return trimmed;
}

function parseSplashNumber(
  value: unknown,
  fallback: number,
  field: string,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    console.warn(`Invalid splash.${field}. Falling back to default.`);
    return fallback;
  }

  return rounded;
}

function parseSplashOptionalNumber(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    console.warn(`Invalid splash.${field}. Ignoring value.`);
    return undefined;
  }

  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    console.warn(`Invalid splash.${field}. Ignoring value.`);
    return undefined;
  }

  return rounded;
}

function isValidSplashColor(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;

  const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgbLikeColor = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,]+\)$/i;
  const namedColor = /^[a-zA-Z]+$/;

  return hexColor.test(trimmed) || rgbLikeColor.test(trimmed) || namedColor.test(trimmed);
}

function parseSplashColor(value: unknown, fallback: string, field: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!isValidSplashColor(trimmed)) {
    console.warn(`Invalid splash.${field}. Falling back to default.`);
    return fallback;
  }

  return trimmed;
}

function normalizeSplashConfig(
  input: Partial<SplashConfig> | undefined,
  defaults: SplashConfig,
  envEnabledOverride?: boolean
): SplashConfig {
  return {
    enabled: envEnabledOverride ?? parseSplashBoolean(input?.enabled, defaults.enabled),
    customHtmlPath: parseSplashPath(input?.customHtmlPath),
    logoPath: parseSplashPath(input?.logoPath),
    logoWidth: parseSplashNumber(input?.logoWidth, defaults.logoWidth, 'logoWidth', 16, 512),
    logoHeight: parseSplashOptionalNumber(input?.logoHeight, 'logoHeight', 16, 512),
    backgroundColor: parseSplashColor(input?.backgroundColor, defaults.backgroundColor, 'backgroundColor'),
    textColor: parseSplashColor(input?.textColor, defaults.textColor, 'textColor'),
    textColorSecondary: parseSplashColor(
      input?.textColorSecondary,
      defaults.textColorSecondary,
      'textColorSecondary'
    ),
    accentColor: parseSplashColor(input?.accentColor, defaults.accentColor, 'accentColor'),
    loadingText: parseSplashString(input?.loadingText, defaults.loadingText, 'loadingText', 120),
    appName: parseSplashString(input?.appName, defaults.appName, 'appName', 64),
    showVersion: parseSplashBoolean(input?.showVersion, defaults.showVersion),
  };
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
  splash: {
    enabled: true,
    logoWidth: 80,
    backgroundColor: '#1a1a2e',
    textColor: '#e8e8e8',
    textColorSecondary: '#a0a0a0',
    accentColor: '#4f46e5',
    loadingText: 'Connecting...',
    appName: 'Switchboard',
    showVersion: true,
  },
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
  const loadedConfig = loadConfigFile();
  const fileConfig = loadedConfig?.config ?? {};
  const configDirectory = loadedConfig ? path.dirname(loadedConfig.path) : undefined;

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
    configDirectory,
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

    splash: normalizeSplashConfig(
      fileConfig.splash,
      DEFAULTS.splash,
      hasEnv('SPLASH_ENABLED') ? getEnvBool('SPLASH_ENABLED', true) : undefined
    ),
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
