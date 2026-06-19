import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import semver from 'semver';
import ora from 'ora';
import chalk from 'chalk';
import { parseNpmrc, mergeRegistryConfig } from '../lib/config.js';
import { fetchLatestVersion, determineUpdateType } from '../lib/registry.js';
import { discoverWorkspace, findWorkspacePackageDirs, parsePnpmWorkspace } from '../lib/workspace.js';
import { printResults, printResultsJson } from '../lib/output.js';
import type { CheckOptions, DependencyResult, DependencyType, PackageCheckResult, RegistryConfig } from '../types.js';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const LOCAL_PREFIXES = ['workspace:', 'link:', 'file:', 'git+', 'git://', 'github:', 'https://', 'http://'];

function isLocalDep(version: string): boolean {
  return LOCAL_PREFIXES.some((p) => version.startsWith(p));
}

async function runBatch<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Builds the new spec string for a dependency, preserving the original range
 * operator (^, ~) or exact-pin style. Returns null for specs we can't safely
 * rewrite (e.g. ">=1.0.0", "1.x", "*").
 */
function buildUpdatedSpec(currentSpec: string, latestVersion: string): string | null {
  const prefixMatch = currentSpec.match(/^[\^~]/);
  if (prefixMatch) return `${prefixMatch[0]}${latestVersion}`;
  if (semver.valid(currentSpec)) return latestVersion;
  return null;
}

function detectIndent(raw: string): string {
  const match = raw.match(/\n([ \t]+)\S/);
  return match ? match[1] : '  ';
}

function writeUpdatedPackageJson(
  pkgPath: string,
  pkg: PackageJson,
  updatesByType: Map<DependencyType, Map<string, string>>,
): void {
  const raw = readFileSync(pkgPath, 'utf-8');
  const indent = detectIndent(raw);

  for (const [type, updates] of updatesByType) {
    const section = pkg[type];
    if (!section) continue;
    for (const [name, newSpec] of updates) section[name] = newSpec;
  }

  const serialized = JSON.stringify(pkg, null, indent);
  writeFileSync(pkgPath, raw.endsWith('\n') ? `${serialized}\n` : serialized);
}

async function checkPackage(
  packageDir: string,
  rootDir: string,
  baseConfig: RegistryConfig,
  options: CheckOptions,
  onProgress: (name: string) => void,
): Promise<PackageCheckResult | null> {
  const pkgPath = join(packageDir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;

  // Merge package-level .npmrc on top of root/base config
  const localConfig = parseNpmrc(packageDir, rootDir);
  const effectiveConfig: RegistryConfig = {
    default:
      localConfig.default !== 'https://registry.npmjs.org' ? localConfig.default : baseConfig.default,
    scoped: new Map([...baseConfig.scoped, ...localConfig.scoped]),
    tokens: new Map([...baseConfig.tokens, ...localConfig.tokens]),
  };

  const entries: Array<{ name: string; version: string; type: DependencyType }> = [];

  const push = (deps: Record<string, string> | undefined, type: DependencyType) => {
    if (!deps) return;
    for (const [name, version] of Object.entries(deps)) {
      entries.push({ name, version, type });
    }
  };

  push(pkg.dependencies, 'dependencies');
  if (options.includeDev) push(pkg.devDependencies, 'devDependencies');
  if (options.includePeer) push(pkg.peerDependencies, 'peerDependencies');
  if (options.includeOptional) push(pkg.optionalDependencies, 'optionalDependencies');

  const filtered = entries
    .filter((e) => !isLocalDep(e.version))
    .filter((e) => !options.filter || e.name.includes(options.filter));

  const results: DependencyResult[] = [];

  await runBatch(filtered, options.concurrency, async (dep) => {
    const { latestVersion, registry, error } = await fetchLatestVersion(
      dep.name,
      effectiveConfig,
      options.registry,
    );

    const updateType =
      latestVersion && !error ? determineUpdateType(dep.version, latestVersion) : 'unknown';

    results.push({
      name: dep.name,
      currentSpec: dep.version,
      latestVersion: latestVersion ?? null,
      updateType,
      dependencyType: dep.type,
      registry,
      error,
    });

    onProgress(dep.name);
  });

  // Restore original order
  const order = new Map(filtered.map((e, i) => [`${e.name}:${e.type}`, i]));
  results.sort(
    (a, b) =>
      (order.get(`${a.name}:${a.dependencyType}`) ?? 0) -
      (order.get(`${b.name}:${b.dependencyType}`) ?? 0),
  );

  if (options.update) {
    const updatesByType = new Map<DependencyType, Map<string, string>>();

    for (const dep of results) {
      if (dep.error || !dep.latestVersion || dep.updateType === 'none' || dep.updateType === 'unknown') {
        continue;
      }

      const newSpec = buildUpdatedSpec(dep.currentSpec, dep.latestVersion);
      if (!newSpec || newSpec === dep.currentSpec) continue;

      if (!updatesByType.has(dep.dependencyType)) updatesByType.set(dep.dependencyType, new Map());
      updatesByType.get(dep.dependencyType)!.set(dep.name, newSpec);
      dep.appliedSpec = newSpec;
    }

    if (updatesByType.size > 0) {
      writeUpdatedPackageJson(pkgPath, pkg, updatesByType);
    }
  }

  return {
    packagePath: pkgPath,
    packageName: pkg.name ?? packageDir,
    dependencies: results,
  };
}

export async function checkCommand(options: CheckOptions): Promise<void> {
  const rootDir = resolve(options.path);

  if (!existsSync(join(rootDir, 'package.json'))) {
    console.error(chalk.red(`No package.json found in ${rootDir}`));
    process.exit(1);
  }

  console.log(chalk.bold('\ndepup — Dependency Update Checker\n'));

  const spinner = ora({ text: 'Discovering packages…', color: 'cyan' }).start();

  try {
    const packageDirs: string[] = [rootDir];

    if (options.workspace) {
      const discovery = discoverWorkspace(rootDir);

      if (discovery.manager === 'none') {
        spinner.warn('No workspace configuration found (no pnpm-workspace.yaml or package.json#workspaces)');
      } else {
        const workspaceDirs = await findWorkspacePackageDirs(rootDir, discovery.patterns);
        packageDirs.push(...workspaceDirs);

        const managerLabel = discovery.manager === 'pnpm' ? 'pnpm' : discovery.manager === 'yarn' ? 'Yarn' : 'npm';
        spinner.text = `Found ${workspaceDirs.length} workspace package(s) [${managerLabel}]`;

        // Merge pnpm-workspace.yaml registries into base config
        if (discovery.registries.size > 0) {
          const detail = [...discovery.registries.keys()].join(', ');
          spinner.text += ` · ${discovery.registries.size} registry mapping(s): ${detail}`;
        }
      }
    }

    // Build base registry config: user ~/.npmrc + root .npmrc + pnpm-workspace.yaml registries
    let baseConfig = parseNpmrc(rootDir);
    const pnpmWorkspace = parsePnpmWorkspace(rootDir);
    if (pnpmWorkspace && pnpmWorkspace.registries.size > 0) {
      baseConfig = mergeRegistryConfig(baseConfig, pnpmWorkspace.registries);
    }

    const allResults: PackageCheckResult[] = [];
    let totalChecked = 0;

    for (const dir of packageDirs) {
      const result = await checkPackage(dir, rootDir, baseConfig, options, (name) => {
        totalChecked++;
        spinner.text = `[${totalChecked}] ${chalk.dim(name)}…`;
      });

      if (result) allResults.push(result);
    }

    const totalDeps = allResults.reduce((sum, r) => sum + r.dependencies.length, 0);
    spinner.succeed(
      `Checked ${chalk.bold(String(totalDeps))} dependencies across ${chalk.bold(String(packageDirs.length))} package(s)`,
    );

    if (options.json) {
      printResultsJson(allResults);
    } else {
      printResults(allResults, options.all);
    }

    const hasOutdated = allResults.some((r) =>
      r.dependencies.some((d) => d.updateType !== 'none' && d.updateType !== 'unknown'),
    );
    process.exit(hasOutdated ? 1 : 0);
  } catch (err) {
    spinner.fail('Failed');
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
