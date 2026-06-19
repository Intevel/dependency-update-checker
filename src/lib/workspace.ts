import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { glob } from 'glob';
import type { PnpmWorkspaceConfig } from '../types.js';

interface RawPnpmWorkspace {
  packages?: string[];
  registries?: Record<string, string>;
  [key: string]: unknown;
}

interface WorkspaceRootPackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export function parsePnpmWorkspace(rootDir: string): PnpmWorkspaceConfig | null {
  const workspaceFile = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) return null;

  const raw = parse(readFileSync(workspaceFile, 'utf-8')) as RawPnpmWorkspace;

  const registries = new Map<string, string>();
  if (raw.registries) {
    for (const [scope, url] of Object.entries(raw.registries)) {
      const normalizedScope = scope.startsWith('@') ? scope : `@${scope}`;
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      registries.set(normalizedScope, normalizedUrl);
    }
  }

  return {
    packages: raw.packages ?? [],
    registries,
  };
}

/**
 * Reads workspace package patterns from npm/yarn workspaces in package.json.
 * Returns null if not a workspace root.
 */
function parseNpmWorkspaces(rootDir: string): string[] | null {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as WorkspaceRootPackageJson;
  if (!pkg.workspaces) return null;

  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg.workspaces.packages) return pkg.workspaces.packages;
  return null;
}

export type WorkspaceManager = 'pnpm' | 'npm' | 'yarn' | 'none';

export interface WorkspaceDiscovery {
  manager: WorkspaceManager;
  patterns: string[];
  registries: Map<string, string>;
}

/**
 * Auto-detects monorepo setup and returns workspace package patterns + registry config.
 */
export function discoverWorkspace(rootDir: string): WorkspaceDiscovery {
  // pnpm takes priority
  const pnpm = parsePnpmWorkspace(rootDir);
  if (pnpm && pnpm.packages.length > 0) {
    return { manager: 'pnpm', patterns: pnpm.packages, registries: pnpm.registries };
  }

  // npm/yarn workspaces in package.json
  const npmPatterns = parseNpmWorkspaces(rootDir);
  if (npmPatterns && npmPatterns.length > 0) {
    const manager = existsSync(join(rootDir, 'yarn.lock')) ? 'yarn' : 'npm';
    return { manager, patterns: npmPatterns, registries: new Map() };
  }

  return { manager: 'none', patterns: [], registries: new Map() };
}

export async function findWorkspacePackageDirs(rootDir: string, patterns: string[]): Promise<string[]> {
  const dirs: string[] = [];
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));

  for (const pattern of includes) {
    const matches = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      ignore: excludes,
    });

    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        dirs.push(match);
      }
    }
  }

  return dirs;
}
