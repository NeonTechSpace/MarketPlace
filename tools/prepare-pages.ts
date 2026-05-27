import { preparePagesOutput, resolveRootFromArgs } from './lib/marketplace.js';

const { rootDir, check, outputDir, sourceCommit } = resolveRootFromArgs(process.argv.slice(2), process.cwd());

preparePagesOutput({ rootDir, outputDir, marketplaceCommitSha: sourceCommit, check })
    .then(() => {
        process.stdout.write(check ? 'Pages catalog output is current.\n' : 'Pages catalog output prepared.\n');
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
