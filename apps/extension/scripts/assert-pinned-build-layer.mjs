/**
 * Configuration lint: WXT must be pinned to an exact version, never a range.
 *
 * WXT is still pre-1.0 two years after announcing an imminent 1.0. It generates the manifest,
 * so a silent minor bump can change the shipped permission set — a failure that surfaces at
 * extension load time, not at typecheck. Pinning is the mitigation the stack audit recorded;
 * this check is what keeps the mitigation from quietly eroding.
 */
import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PINNED_DEPENDENCIES = ['wxt'];

const manifestUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await readFile(manifestUrl, 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

const offenders = PINNED_DEPENDENCIES.filter((name) => !EXACT_VERSION.test(declared[name] ?? ''));

if (offenders.length > 0) {
  for (const name of offenders) {
    console.error(
      `${argv[1]}: ${name} is declared as "${declared[name]}" — it must be an exact version, not a range.`,
    );
  }
  exit(1);
}
