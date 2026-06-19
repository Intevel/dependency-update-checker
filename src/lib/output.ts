import chalk from 'chalk';
import Table from 'cli-table3';
import type { DependencyResult, PackageCheckResult, UpdateType } from '../types.js';

const UPDATE_COLORS: Record<UpdateType, (s: string) => string> = {
  major: chalk.red,
  minor: chalk.yellow,
  patch: chalk.green,
  none: chalk.dim,
  unknown: chalk.dim,
};

const UPDATE_LABELS: Record<UpdateType, string> = {
  major: 'major',
  minor: 'minor',
  patch: 'patch',
  none: '✓',
  unknown: '?',
};

const DEP_TYPE_SHORT: Record<string, string> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
  optionalDependencies: 'optional',
};

function badge(type: UpdateType): string {
  const color = UPDATE_COLORS[type];
  return color(UPDATE_LABELS[type]);
}

export function printResults(results: PackageCheckResult[], showAll: boolean): void {
  let totalOutdated = 0;
  let totalErrors = 0;
  let totalUpdated = 0;

  for (const pkg of results) {
    const outdated = pkg.dependencies.filter((d) => d.updateType !== 'none' && !d.error);
    const errors = pkg.dependencies.filter((d) => d.error);
    const updated = pkg.dependencies.filter((d) => d.appliedSpec);
    totalOutdated += outdated.length;
    totalErrors += errors.length;
    totalUpdated += updated.length;

    console.log('\n' + chalk.bold(chalk.cyan(pkg.packageName)));
    console.log(chalk.dim('  ' + pkg.packagePath));

    if (pkg.dependencies.length === 0) {
      console.log(chalk.dim('  No dependencies'));
      continue;
    }

    const rows = showAll
      ? pkg.dependencies
      : pkg.dependencies.filter((d) => d.updateType !== 'none' || d.error);

    if (rows.length === 0) {
      console.log(chalk.green('  All dependencies up to date'));
      continue;
    }

    const table = new Table({
      head: [
        chalk.bold('Package'),
        chalk.bold('Spec'),
        chalk.bold('Latest'),
        chalk.bold('Type'),
        chalk.bold('Update'),
      ],
      style: { head: [], border: ['dim'] },
      chars: {
        top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
        right: '│', 'right-mid': '┤', middle: '│',
      },
    });

    for (const dep of rows) {
      const color = UPDATE_COLORS[dep.updateType];
      const latestCell = dep.error
        ? chalk.red(`⚠ ${dep.error}`)
        : dep.latestVersion
          ? color(dep.latestVersion)
          : chalk.dim('—');

      const updateCell = dep.error ? chalk.red('error') : dep.appliedSpec ? chalk.green('updated') : badge(dep.updateType);

      const specCell = dep.appliedSpec
        ? `${chalk.dim(dep.currentSpec)} ${chalk.dim('→')} ${chalk.green(dep.appliedSpec)}`
        : chalk.dim(dep.currentSpec);

      table.push([
        dep.name,
        specCell,
        latestCell,
        chalk.dim(DEP_TYPE_SHORT[dep.dependencyType] ?? dep.dependencyType),
        updateCell,
      ]);
    }

    console.log(table.toString());
  }

  console.log('');

  const parts: string[] = [];
  if (totalOutdated > 0) {
    parts.push(
      chalk.red(`${totalOutdated} outdated`) +
        '  ' +
        chalk.dim('(') +
        chalk.red('major') +
        chalk.dim(' · ') +
        chalk.yellow('minor') +
        chalk.dim(' · ') +
        chalk.green('patch') +
        chalk.dim(')'),
    );
  } else {
    parts.push(chalk.green('All dependencies up to date'));
  }
  if (totalUpdated > 0) parts.push(chalk.green(`${totalUpdated} updated`));
  if (totalErrors > 0) parts.push(chalk.dim(`${totalErrors} error(s)`));

  console.log(chalk.bold('Summary  ') + parts.join('  '));
}

export function printResultsJson(results: PackageCheckResult[]): void {
  console.log(JSON.stringify(results, null, 2));
}
