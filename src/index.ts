import { Command, Option } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkCommand } from './commands/check.js';
import type { CheckOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
  .name('depup')
  .description('Check npm/pnpm dependencies for available updates')
  .version(pkg.version);

program
  .addOption(new Option('-p, --path <path>', 'Project directory to check').default('.'))
  .addOption(new Option('-r, --registry <url>', 'Override registry URL for all packages'))
  .addOption(
    new Option(
      '-w, --workspace',
      'Monorepo mode: scan all sub-packages defined in pnpm-workspace.yaml or package.json#workspaces',
    ).default(false),
  )
  .addOption(new Option('--include-dev', 'Include devDependencies (default)').default(true))
  .addOption(new Option('--no-include-dev', 'Exclude devDependencies'))
  .addOption(new Option('--include-peer', 'Include peerDependencies').default(false))
  .addOption(new Option('--include-optional', 'Include optionalDependencies').default(false))
  .addOption(new Option('-f, --filter <pattern>', 'Only check packages whose name contains this string'))
  .addOption(new Option('-a, --all', 'Show all packages, not only outdated ones').default(false))
  .addOption(
    new Option(
      '-u, --update',
      'Write resolved latest versions back into package.json (only for ^, ~ and exact specs)',
    ).default(false),
  )
  .addOption(new Option('--json', 'Output results as JSON').default(false))
  .addOption(
    new Option('-c, --concurrency <n>', 'Concurrent registry requests')
      .default(10)
      .argParser((v) => parseInt(v, 10)),
  )
  .action((options: CheckOptions) => {
    void checkCommand(options);
  });

program.parse();
