/**
 * Index provisioning entry point.
 *
 * ```bash
 * pnpm --filter @votion/search run provision          # idempotent
 * pnpm --filter @votion/search run provision -- --tenant eu
 * ```
 *
 * Runs the same code path as `MeiliSearchClient.ensureIndex()`, so a deploy and
 * a manual run can never disagree about the schema. Exits non-zero on failure,
 * which is what the deployment pipeline checks.
 */

import {
  MeiliSearchConfigurationError,
  createMeiliSearchClient,
} from '../client/MeiliSearchClient.js';
import { blocksIndexUid } from '../client/indexSchema.js';

export interface ProvisionOptions {
  /** Tenant prefix (sharded index) — omit for the shared index. */
  tenant?: string;
  /** Do not wait for Meilisearch tasks (fire-and-forget deploys). */
  noWait?: boolean;
}

/** Parses `--tenant=eu` / `--tenant eu` / `--no-wait`. */
export function parseProvisionArgs(argv: readonly string[]): ProvisionOptions {
  const options: ProvisionOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-wait') {
      options.noWait = true;
      continue;
    }
    if (argument === '--tenant') {
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('--')) {
        options.tenant = value;
        index += 1;
      }
      continue;
    }
    if (argument !== undefined && argument.startsWith('--tenant=')) {
      options.tenant = argument.slice('--tenant='.length);
    }
  }
  return options;
}

/** Runs provisioning and returns a process exit code (0 on success). */
export async function provision(
  options: ProvisionOptions = {},
): Promise<number> {
  const indexUid = options.tenant ? blocksIndexUid(options.tenant) : undefined;
  try {
    const client = createMeiliSearchClient(
      indexUid === undefined ? {} : { indexUid },
    );
    const version = await client.version();
    const result = await client.ensureIndex({ wait: options.noWait !== true });
    const lines = [
      `meilisearch ${version}`,
      `index       ${result.indexUid}`,
      `created     ${result.created}`,
      `settings    ${result.settingsUpdated.length === 0 ? 'up to date' : result.settingsUpdated.join(', ')}`,
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof MeiliSearchConfigurationError
        ? `${error.message}\nSet MEILISEARCH_HOST / MEILISEARCH_API_KEY first.`
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(`votion search provisioning failed: ${message}\n`);
    return 1;
  }
}

/* Executed directly (`node dist/scripts/provision.js`). */
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /provision\.(js|ts)$/.test(process.argv[1]);

if (invokedDirectly) {
  void provision(parseProvisionArgs(process.argv.slice(2))).then((code) => {
    process.exitCode = code;
  });
}
