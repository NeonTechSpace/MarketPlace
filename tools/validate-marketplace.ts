import { validateMarketplace } from './lib/marketplace.js';
import { validateSourceIntakeCatalogs } from './lib/source-intake.js';

const rootDir = process.cwd();

Promise.all([validateSourceIntakeCatalogs(rootDir), validateMarketplace(rootDir)])
    .then(([_sourceCatalogs, result]) => {
        process.stdout.write(`Marketplace validation passed (${result.packages.length} packages).\n`);
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
