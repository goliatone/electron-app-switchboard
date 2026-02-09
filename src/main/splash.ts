/**
 * Splash Screen Module
 *
 * Generates or loads a configurable splash screen shown while the app loads.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { SplashConfig } from '../shared/config';

const SPLASH_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:;";

/**
 * Get the MIME type for an image file based on extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'image/png';
  }
}

/**
 * Resolve a path that may be relative to the app directory
 */
function resolveAssetPath(assetPath: string, configDirectory?: string): string {
  if (path.isAbsolute(assetPath)) {
    return assetPath;
  }

  // Try relative to loaded config file directory first.
  if (configDirectory) {
    const configRelativePath = path.join(configDirectory, assetPath);
    if (fs.existsSync(configRelativePath)) {
      return configRelativePath;
    }
  }

  // Try relative to app resources first (for packaged app)
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, assetPath);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
  }

  // Try relative to current working directory
  const cwdPath = path.join(process.cwd(), assetPath);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // Try relative to app directory (development)
  const appPath = path.join(__dirname, '../..', assetPath);
  if (fs.existsSync(appPath)) {
    return appPath;
  }

  return assetPath;
}

/**
 * Load an image file and convert to base64 data URL
 */
function loadLogoAsDataUrl(logoPath: string, configDirectory?: string): string | null {
  try {
    const resolvedPath = resolveAssetPath(logoPath, configDirectory);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`Splash logo not found: ${resolvedPath}`);
      return null;
    }

    const buffer = fs.readFileSync(resolvedPath);
    const mimeType = getMimeType(resolvedPath);
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Failed to load splash logo:', error);
    return null;
  }
}

/**
 * Load custom splash HTML file
 */
function loadCustomSplashHtml(htmlPath: string, configDirectory?: string): string | null {
  try {
    const resolvedPath = resolveAssetPath(htmlPath, configDirectory);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`Custom splash HTML not found: ${resolvedPath}`);
      return null;
    }

    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
    console.error('Failed to load custom splash HTML:', error);
    return null;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Enforce a strict CSP for custom splash HTML.
 */
function enforceSplashCsp(html: string, appName: string): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${SPLASH_CSP}">`;
  const cspRegex = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

  if (cspRegex.test(html)) {
    return html.replace(cspRegex, cspMeta);
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${cspMeta}`);
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html([^>]*)>/i,
      `<html$1>\n<head>\n  <meta charset="UTF-8">\n  ${cspMeta}\n  <title>${escapeHtml(appName)}</title>\n</head>`
    );
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${cspMeta}
  <title>${escapeHtml(appName)}</title>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * Generate splash screen HTML from config
 */
function generateSplashHtml(
  config: SplashConfig,
  appVersion: string,
  configDirectory?: string
): string {
  const logoDataUrl = config.logoPath ? loadLogoAsDataUrl(config.logoPath, configDirectory) : null;

  const logoHtml = logoDataUrl
    ? `<img
        src="${logoDataUrl}"
        width="${config.logoWidth}"
        ${config.logoHeight ? `height="${config.logoHeight}"` : ''}
        alt="${escapeHtml(config.appName)}"
        class="logo"
      />`
    : `<div class="logo-placeholder">${escapeHtml(config.appName.charAt(0))}</div>`;

  const versionHtml = config.showVersion
    ? `<p class="version">v${escapeHtml(appVersion)}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${SPLASH_CSP}">
  <title>${escapeHtml(config.appName)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: ${config.backgroundColor};
      color: ${config.textColor};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      -webkit-app-region: drag;
      user-select: none;
    }

    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }

    .logo {
      max-width: 100%;
      height: auto;
    }

    .logo-placeholder {
      width: ${config.logoWidth}px;
      height: ${config.logoWidth}px;
      background: ${config.accentColor};
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${Math.floor(config.logoWidth * 0.5)}px;
      font-weight: 700;
      color: white;
    }

    .app-name {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid ${config.textColorSecondary}33;
      border-top-color: ${config.accentColor};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .loading-text {
      font-size: 14px;
      color: ${config.textColorSecondary};
    }

    .version {
      font-size: 12px;
      color: ${config.textColorSecondary};
      opacity: 0.7;
      position: absolute;
      bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    ${logoHtml}
    <h1 class="app-name">${escapeHtml(config.appName)}</h1>
    <div class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">${escapeHtml(config.loadingText)}</p>
    </div>
  </div>
  ${versionHtml}
</body>
</html>`;
}

/**
 * Get splash screen HTML (either custom or generated)
 *
 * @param config Splash screen configuration
 * @param appVersion Application version string
 * @param configDirectory Directory where config file was loaded from
 * @returns HTML string for the splash screen
 */
export function getSplashHtml(
  config: SplashConfig,
  appVersion: string,
  configDirectory?: string
): string {
  // Try custom HTML first
  if (config.customHtmlPath) {
    const customHtml = loadCustomSplashHtml(config.customHtmlPath, configDirectory);
    if (customHtml) {
      console.log(`Using custom splash HTML from: ${config.customHtmlPath}`);
      return enforceSplashCsp(customHtml, config.appName);
    }
    console.warn(`Custom splash HTML not found, falling back to generated splash`);
  }

  return generateSplashHtml(config, appVersion, configDirectory);
}

/**
 * Get splash screen as a data URL for loading via loadURL
 *
 * @param config Splash screen configuration
 * @param appVersion Application version string
 * @param configDirectory Directory where config file was loaded from
 * @returns Data URL containing the splash HTML
 */
export function getSplashDataUrl(
  config: SplashConfig,
  appVersion: string,
  configDirectory?: string
): string {
  const html = getSplashHtml(config, appVersion, configDirectory);
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Check if splash screen is enabled and should be shown
 */
export function shouldShowSplash(config: SplashConfig): boolean {
  return config.enabled;
}
