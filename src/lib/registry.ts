import semver from 'semver';
import type { UpdateType, RegistryConfig } from '../types.js';
import { getRegistryForPackage } from './config.js';

interface NpmDistTags {
  latest?: string;
  [tag: string]: string | undefined;
}

interface NpmAbbreviatedPackage {
  'dist-tags': NpmDistTags;
}

function encodePackageName(name: string): string {
  if (!name.startsWith('@')) return name;
  // @scope/pkg → @scope%2Fpkg  (some registries require this, others don't)
  // Most modern registries handle both — use the slash form for broader compat
  return name;
}

export async function fetchLatestVersion(
  packageName: string,
  registryConfig: RegistryConfig,
  registryOverride?: string,
): Promise<{ latestVersion: string | null; registry: string; error?: string }> {
  const { url, token } = getRegistryForPackage(packageName, registryConfig, registryOverride);
  const pkgUrl = `${url}/${encodePackageName(packageName)}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.npm.install-v1+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(pkgUrl, { headers, signal: AbortSignal.timeout(10_000) });

    if (res.status === 404) {
      return { latestVersion: null, registry: url, error: 'not found' };
    }
    if (!res.ok) {
      return { latestVersion: null, registry: url, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as NpmAbbreviatedPackage;
    const latest = data['dist-tags']?.latest ?? null;

    return { latestVersion: latest, registry: url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { latestVersion: null, registry: url, error: message };
  }
}

export function determineUpdateType(currentSpec: string, latestVersion: string): UpdateType {
  if (!semver.validRange(currentSpec)) return 'unknown';
  if (!semver.valid(latestVersion)) return 'unknown';

  // Already within range → nothing to update in the spec
  if (semver.satisfies(latestVersion, currentSpec)) return 'none';

  const minVer = semver.minVersion(currentSpec);
  if (!minVer) return 'unknown';

  const diff = semver.diff(minVer.version, latestVersion);
  if (!diff) return 'none';

  if (diff === 'major' || diff === 'premajor') return 'major';
  if (diff === 'minor' || diff === 'preminor') return 'minor';
  return 'patch';
}
