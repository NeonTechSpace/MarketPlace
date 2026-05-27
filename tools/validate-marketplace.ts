import { validateMarketplace } from './lib/marketplace.js';

const rootDir = process.cwd();

validateMarketplace(rootDir)
    .then((result) => {
        process.stdout.write(`Marketplace validation passed (${result.packages.length} packages).\n`);
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
