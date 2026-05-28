import {
    materializeSourceIntakePackage,
    readSourceIntakeCatalogFile,
    type SourceIntakePackage,
} from './lib/source-intake.js';

const sourceFiles = ['sources/skills.v1.json', 'sources/mcps.v1.json', 'sources/modes.v1.json'] as const;

function parseGitHubRepositoryUrl(repositoryUrl: string): { owner: string; repo: string } {
    const parsed = new URL(repositoryUrl);
    if (parsed.hostname !== 'github.com') {
        throw new Error(`Unsupported source repository "${repositoryUrl}": expected github.com.`);
    }
    const [owner, repo, ...rest] = parsed.pathname.replace(/^\/+/u, '').split('/');
    if (!owner || !repo || rest.length > 0) {
        throw new Error(`Unsupported source repository "${repositoryUrl}": expected owner/repo URL.`);
    }
    return { owner, repo: repo.replace(/\.git$/u, '') };
}

async function readResponseBytes(response: Response, label: string): Promise<Uint8Array> {
    if (!response.ok) {
        throw new Error(`Failed to fetch ${label}: HTTP ${String(response.status)}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

async function resolveCommitSha(pkg: SourceIntakePackage): Promise<string> {
    if (pkg.source.commitSha) {
        return pkg.source.commitSha;
    }
    const { owner, repo } = parseGitHubRepositoryUrl(pkg.source.repositoryUrl);
    const ref = pkg.source.ref;
    if (!ref) {
        throw new Error(`Invalid source package "${pkg.kind}:${pkg.slug}": expected ref or commitSha.`);
    }
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
        headers: {
            accept: 'application/vnd.github+json',
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to resolve ${pkg.kind}:${pkg.slug} ref "${ref}": HTTP ${String(response.status)}.`);
    }
    const body = (await response.json()) as { sha?: unknown };
    if (typeof body.sha !== 'string') {
        throw new Error(`Failed to resolve ${pkg.kind}:${pkg.slug} ref "${ref}": missing commit SHA.`);
    }
    return body.sha;
}

async function fetchSourceFiles(pkg: SourceIntakePackage, commitSha: string) {
    const { owner, repo } = parseGitHubRepositoryUrl(pkg.source.repositoryUrl);
    return Promise.all(
        pkg.files.map(async (file) => {
            const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${file.upstreamPath}`;
            return {
                packagePath: file.packagePath,
                bytes: await readResponseBytes(await fetch(url), `${pkg.kind}:${pkg.slug} ${file.upstreamPath}`),
            };
        })
    );
}

async function main(): Promise<void> {
    const check = process.argv.slice(2).includes('--check');
    let sourcePullCount = 0;
    let manualCount = 0;
    for (const sourceFile of sourceFiles) {
        const catalog = await readSourceIntakeCatalogFile(sourceFile);
        for (const pkg of catalog.packages) {
            if (pkg.intake === 'manual_vendored') {
                manualCount += 1;
                continue;
            }
            sourcePullCount += 1;
            if (check) {
                continue;
            }
            const commitSha = await resolveCommitSha(pkg);
            await materializeSourceIntakePackage({
                rootDir: process.cwd(),
                catalogKind: catalog.kind,
                sourcePackage: pkg,
                resolvedCommitSha: commitSha,
                files: await fetchSourceFiles(pkg, commitSha),
            });
        }
    }
    process.stdout.write(
        check
            ? `Source intake check passed (${sourcePullCount} source-pull packages, ${manualCount} manual packages).\n`
            : `Source intake sync completed (${sourcePullCount} source-pull packages, ${manualCount} manual packages).\n`
    );
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
