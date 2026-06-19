import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryConfig } from '../types.js';

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function parseNpmrcFile(filePath: string, config: RegistryConfig): void {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, 'utf-8').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = expandEnvVars(trimmed.slice(eqIdx + 1).trim());

    if (key === 'registry') {
      config.default = normalizeUrl(value);
    } else if (key.endsWith(':registry')) {
      const scope = key.slice(0, -':registry'.length);
      config.scoped.set(scope, normalizeUrl(value));
    } else if (key.includes(':_authToken')) {
      // Format: //registry.host.com/:_authToken=TOKEN
      const hostPart = key.split(':_authToken')[0].replace(/^\/\//, '');
      config.tokens.set(hostPart.replace(/\/$/, ''), value);
    }
  }
}

/**
 * Returns pnpm's per-OS config directory, where auth.ini lives.
 * See https://pnpm.io/npmrc
 */
function pnpmConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'pnpm');

  const userHome = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (process.platform === 'darwin') return join(userHome, 'Library', 'Preferences', 'pnpm');
  if (process.platform === 'win32') return join(userHome, 'AppData', 'Local', 'pnpm', 'config');
  return join(userHome, '.config', 'pnpm');
}

export function parseNpmrc(projectDir: string, rootDir?: string): RegistryConfig {
  const config: RegistryConfig = {
    default: 'https://registry.npmjs.org',
    scoped: new Map(),
    tokens: new Map(),
  };

  // Read in ascending priority: global .npmrc (fallback) → pnpm auth.ini (primary
  // user-level token store since pnpm v11) → root .npmrc → package-level .npmrc
  const userHome = process.env.HOME ?? process.env.USERPROFILE ?? '';
  parseNpmrcFile(join(userHome, '.npmrc'), config);
  parseNpmrcFile(join(pnpmConfigDir(), 'auth.ini'), config);

  if (rootDir && rootDir !== projectDir) {
    parseNpmrcFile(join(rootDir, '.npmrc'), config);
  }

  parseNpmrcFile(join(projectDir, '.npmrc'), config);

  return config;
}

export function mergeRegistryConfig(base: RegistryConfig, override: Map<string, string>): RegistryConfig {
  const merged: RegistryConfig = {
    default: base.default,
    scoped: new Map(base.scoped),
    tokens: new Map(base.tokens),
  };

  for (const [scope, url] of override) {
    merged.scoped.set(scope, url);
  }

  return merged;
}

export function getRegistryForPackage(
  packageName: string,
  config: RegistryConfig,
  override?: string,
): { url: string; token?: string } {
  if (override) return { url: normalizeUrl(override) };

  if (packageName.startsWith('@')) {
    const scope = packageName.split('/')[0];
    if (config.scoped.has(scope)) {
      const url = config.scoped.get(scope)!;
      return { url, token: findToken(url, config.tokens) };
    }
  }

  return { url: config.default, token: findToken(config.default, config.tokens) };
}

function findToken(registryUrl: string, tokens: Map<string, string>): string | undefined {
  try {
    const host = new URL(registryUrl).host;
    for (const [key, token] of tokens) {
      if (key.includes(host)) return token;
    }
  } catch {
    // invalid URL, skip token lookup
  }
  return undefined;
}
