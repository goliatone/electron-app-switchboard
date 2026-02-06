/**
 * Structured diagnostics logging with redaction support.
 *
 * Logs are written as JSON lines for easy machine parsing and export.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, clipboard } from 'electron';
import type { AppConfig } from '../shared/config';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  message: string;
  metadata?: unknown;
}

const LOG_LEVEL_PRIORITY: Record<DiagnosticLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'password',
  'cookie',
  'credential',
  'credentials',
]);

const SENSITIVE_PATTERNS = [
  /(bearer\s+)[a-z0-9._-]+/gi,
  /(["']?(?:access[-_]?token|refresh[-_]?token|api[-_]?key|password|secret|authorization|cookie)["']?\s*[:=]\s*["']?)([^"',\s]+)/gi,
];

let configuredLevel: DiagnosticLevel = 'info';
let diagnosticsPath = '';
let diagnosticsReady = false;

function shouldLog(level: DiagnosticLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function redactText(value: string): string {
  return SENSITIVE_PATTERNS.reduce((result, pattern) => {
    return result.replace(pattern, '$1[REDACTED]');
  }, value);
}

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function redactData(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactData(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(obj)) {
      const normalized = normalizeSensitiveKey(key);
      output[key] = SENSITIVE_KEYS.has(normalized) ? '[REDACTED]' : redactData(nestedValue);
    }
    return output;
  }

  return value;
}

function resolveDiagnosticsPath(): string {
  try {
    const logDir = app.getPath('logs');
    return path.join(logDir, 'switchboard-diagnostics.log');
  } catch {
    return path.join(process.cwd(), 'logs', 'switchboard-diagnostics.log');
  }
}

function ensureDiagnosticsReady(): void {
  if (diagnosticsReady) return;

  diagnosticsPath = resolveDiagnosticsPath();
  const dir = path.dirname(diagnosticsPath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(diagnosticsPath)) {
    fs.writeFileSync(diagnosticsPath, '', 'utf-8');
  }

  diagnosticsReady = true;
}

function appendEntry(entry: DiagnosticEntry): void {
  ensureDiagnosticsReady();
  fs.appendFileSync(diagnosticsPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

export function initializeDiagnostics(logLevel: AppConfig['logLevel']): void {
  configuredLevel = logLevel;
  ensureDiagnosticsReady();
  logDiagnostic('info', 'diagnostics.init', 'Diagnostics initialized', {
    logPath: diagnosticsPath,
    logLevel,
  });
}

export function logDiagnostic(
  level: DiagnosticLevel,
  event: string,
  message: string,
  metadata?: unknown
): void {
  if (!shouldLog(level)) return;

  const entry: DiagnosticEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message: redactText(message),
  };

  if (metadata !== undefined) {
    entry.metadata = redactData(metadata);
  }

  appendEntry(entry);
}

export function getDiagnosticsLogPath(): string {
  ensureDiagnosticsReady();
  return diagnosticsPath;
}

function readDiagnosticsTail(maxBytes: number): string {
  ensureDiagnosticsReady();

  const stat = fs.statSync(diagnosticsPath);
  if (stat.size === 0) return '';

  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(diagnosticsPath, 'r');

  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function formatExportTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export function copyDiagnosticsToClipboard(maxBytes = 256 * 1024): number {
  const diagnostics = readDiagnosticsTail(maxBytes);
  clipboard.writeText(diagnostics);
  logDiagnostic('info', 'diagnostics.copy', 'Copied diagnostics to clipboard', {
    bytes: Buffer.byteLength(diagnostics, 'utf-8'),
  });
  return diagnostics.length;
}

export function exportDiagnosticsLog(
  targetPath?: string,
  maxBytes = 2 * 1024 * 1024
): string {
  const timestamp = formatExportTimestamp(new Date());
  const resolvedPath = targetPath ?? (() => {
    try {
      return path.join(
        app.getPath('downloads'),
        `switchboard-diagnostics-${timestamp}.log`
      );
    } catch {
      return path.join(process.cwd(), `switchboard-diagnostics-${timestamp}.log`);
    }
  })();

  const diagnostics = readDiagnosticsTail(maxBytes);
  const header = [
    '# Switchboard Diagnostics Export',
    `generatedAt=${new Date().toISOString()}`,
    `sourceLogPath=${getDiagnosticsLogPath()}`,
    '',
  ].join('\n');

  fs.writeFileSync(resolvedPath, `${header}${diagnostics}`, 'utf-8');
  logDiagnostic('info', 'diagnostics.export', 'Exported diagnostics log', {
    path: resolvedPath,
    bytes: Buffer.byteLength(diagnostics, 'utf-8'),
  });
  return resolvedPath;
}
