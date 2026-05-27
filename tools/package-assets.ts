import { packageMarketplace, resolveRootFromArgs } from './lib/marketplace.js';

const { rootDir, check } = resolveRootFromArgs(process.argv.slice(2), process.cwd());

packageMarketplace(rootDir, { check })
    .then((results) => {
        process.stdout.write(
            check
                ? `Package artifact check passed (${results.length} packages).\n`
                : `Package artifacts written (${results.length} packages).\n`
        );
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
