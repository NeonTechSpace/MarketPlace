import { checkGeneratedCatalog, resolveRootFromArgs, writeGeneratedCatalog } from './lib/marketplace.js';

const { rootDir, check } = resolveRootFromArgs(process.argv.slice(2), process.cwd());

(check ? checkGeneratedCatalog(rootDir) : writeGeneratedCatalog(rootDir))
    .then(() => {
        process.stdout.write(check ? 'Generated catalog is current.\n' : 'Generated catalog updated.\n');
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
