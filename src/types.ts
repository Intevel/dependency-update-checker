export type UpdateType = 'major' | 'minor' | 'patch' | 'none' | 'unknown';

export type DependencyType =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export interface DependencyResult {
  name: string;
  currentSpec: string;
  latestVersion: string | null;
  updateType: UpdateType;
  dependencyType: DependencyType;
  registry: string;
  error?: string;
  /** Set to the new spec when -u/--update wrote it into package.json */
  appliedSpec?: string;
}

export interface PackageCheckResult {
  packagePath: string;
  packageName: string;
  dependencies: DependencyResult[];
}

export interface RegistryConfig {
  default: string;
  scoped: Map<string, string>;
  tokens: Map<string, string>;
}

export interface PnpmWorkspaceConfig {
  packages: string[];
  registries: Map<string, string>;
}

export interface CheckOptions {
  path: string;
  registry?: string;
  /** Enable monorepo/workspace mode: scan all sub-packages */
  workspace: boolean;
  includeDev: boolean;
  includePeer: boolean;
  includeOptional: boolean;
  filter?: string;
  json: boolean;
  concurrency: number;
  /** Show all packages, not just outdated ones */
  all: boolean;
  /** Write resolved latest versions back into package.json */
  update: boolean;
}
