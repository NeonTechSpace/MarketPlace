import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    buildGeneratedCatalog,
    buildPackageArchive,
    checkGeneratedCatalog,
    packageMarketplace,
    resolveRootFromArgs,
    sha256File,
    validateMarketplace,
    writeGeneratedCatalog,
    type LicenseReviewStatus,
    type PackageKind,
} from './lib/marketplace.js';

interface FixturePackageInput {
    kind: PackageKind;
    slug: string;
    version?: string;
    reviewStatus?: LicenseReviewStatus;
    spdxExpression?: string;
    sourceRelativePath?: string;
    entryRelativePath?: string;
    writeEntry?: boolean;
    artifactSha256?: string;
    artifactSizeBytes?: number;
    sourceRepositoryUrl?: string;
}

async function withTempMarketplace<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'neon-marketplace-'));
    try {
        return await fn(rootDir);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
}

function sha256Buffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

function kindRoot(kind: PackageKind): string {
    if (kind === 'skill') {
        return 'skills';
    }
    if (kind === 'mode') {
        return 'modes';
    }
    return 'mcps';
}

function entryFileName(kind: PackageKind): string {
    if (kind === 'skill') {
        return 'SKILL.md';
    }
    if (kind === 'mode') {
        return 'MODE.yaml';
    }
    return 'MCP.yaml';
}

async function addPackage(rootDir: string, input: FixturePackageInput): Promise<string> {
    const version = input.version ?? '1.0.0';
    const packageRoot = path.join(rootDir, kindRoot(input.kind), input.slug);
    await mkdir(packageRoot, { recursive: true });
    const entryRelativePath = input.entryRelativePath ?? `${kindRoot(input.kind)}/${input.slug}/${entryFileName(input.kind)}`;
    const entryPath = path.join(rootDir, entryRelativePath);
    if (input.writeEntry !== false) {
        await mkdir(path.dirname(entryPath), { recursive: true });
        await writeFile(entryPath, `${input.kind} fixture for ${input.slug}\n`, 'utf8');
    }
    const licenseRelativePath = `${kindRoot(input.kind)}/${input.slug}/LICENSE`;
    const licensePath = path.join(rootDir, licenseRelativePath);
    await writeFile(licensePath, 'MIT License\n\nCopyright Neon\n', 'utf8');
    const artifactSha256 = input.artifactSha256 ?? sha256Buffer(await buildPackageArchive(packageRoot));
    const metadata = {
        kind: input.kind,
        slug: input.slug,
        version,
        name: input.slug
            .split('-')
            .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
            .join(' '),
        summary: `Fixture ${input.kind} package.`,
        source: {
            repositoryUrl: input.sourceRepositoryUrl ?? 'https://github.com/NeonTechSpace/MarketPlace',
            relativePath: input.sourceRelativePath ?? `${kindRoot(input.kind)}/${input.slug}`,
        },
        artifact: {
            url: `https://neontechspace.github.io/MarketPlace/artifacts/${kindRoot(input.kind)}/${input.slug}-${version}.tgz`,
            sha256: artifactSha256,
            ...(input.artifactSizeBytes !== undefined ? { sizeBytes: input.artifactSizeBytes } : {}),
        },
        compatibility: {
            neonVersionRange: '>=0.0.1 <1.0.0',
            requiredCapabilities: [input.kind === 'mcp' ? 'mcp' : `${input.kind}s`],
        },
        ...(input.kind === 'skill'
            ? { skill: { entryFile: entryRelativePath } }
            : input.kind === 'mode'
              ? { mode: { manifestFile: entryRelativePath } }
              : { mcp: { manifestFile: entryRelativePath, serverLabel: input.slug } }),
    };
    const authored = {
        schemaVersion: 1,
        metadata,
        compliance: {
            sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
            license: {
                spdxExpression: input.spdxExpression ?? 'MIT',
                evidencePath: licenseRelativePath,
                evidenceSha256: await sha256File(licensePath),
                reviewStatus: input.reviewStatus ?? 'approved',
                notices: ['MIT License'],
            },
        },
    };
    const metadataPath = path.join(packageRoot, 'marketplace.v1.json');
    await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');
    return packageRoot;
}

describe('marketplace validation', () => {
    it('accepts an empty marketplace and writes the deterministic generated catalog', async () => {
        await withTempMarketplace(async (rootDir) => {
            await writeGeneratedCatalog(rootDir);
            await checkGeneratedCatalog(rootDir);

            const catalog = JSON.parse(await readFile(path.join(rootDir, 'generated', 'catalog.v1.json'), 'utf8')) as {
                packages: unknown[];
            };
            expect(catalog.packages).toEqual([]);
        });
    });

    it('accepts valid skill, mode, and MCP fixture packages', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, { kind: 'mode', slug: 'focused-implementer' });
            await addPackage(rootDir, { kind: 'mcp', slug: 'local-files' });

            const result = await validateMarketplace(rootDir);
            expect(result.packages.map((pkg) => pkg.metadata.kind)).toEqual(['mcp', 'mode', 'skill']);
            expect(buildGeneratedCatalog(result.packages.map((pkg) => pkg.metadata)).packages).toHaveLength(3);
        });
    });

    it('rejects duplicate package identities', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review-copy',
                sourceRelativePath: 'skills/repo-review-copy',
            });
            const copyMetadataPath = path.join(rootDir, 'skills', 'repo-review-copy', 'marketplace.v1.json');
            const copy = JSON.parse(await readFile(copyMetadataPath, 'utf8')) as { metadata: { slug: string } };
            copy.metadata.slug = 'repo-review';
            await writeFile(copyMetadataPath, `${JSON.stringify(copy, null, 4)}\n`, 'utf8');

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/duplicate package identity/u);
        });
    });

    it('rejects missing package entry files', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                entryRelativePath: 'skills/repo-review/missing.md',
                writeEntry: false,
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/entry or manifest file does not exist/u);
        });
    });

    it('rejects unsafe paths and non-HTTPS URLs', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                sourceRepositoryUrl: 'http://example.com/repo',
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/HTTPS/u);
        });
    });

    it('rejects invalid artifact SHA and compatibility ranges', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const metadataPath = path.join(rootDir, 'skills', 'repo-review', 'marketplace.v1.json');
            const authored = JSON.parse(await readFile(metadataPath, 'utf8')) as {
                metadata: { artifact: { sha256: string }; compatibility: { neonVersionRange: string } };
            };
            authored.metadata.artifact.sha256 = 'abc';
            authored.metadata.compatibility.neonVersionRange = 'not a range';
            await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/SHA-256/u);
        });
    });

    it('rejects no-license and manual-review package status', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                reviewStatus: 'blocked_no_license',
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/blocked_no_license/u);
        });
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                reviewStatus: 'manual_review',
                spdxExpression: 'GPL-3.0-only',
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/manual_review/u);
        });
    });

    it('rejects approved status for licenses that need manual review', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                spdxExpression: 'GPL-3.0-only',
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/requires manual review/u);
        });
    });

    it('checks deterministic package hashes against metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });

            const first = await packageMarketplace(rootDir, { check: true });
            const second = await packageMarketplace(rootDir, { check: true });
            expect(first).toEqual(second);
            expect(first[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
        });
    });

    it('rejects mismatched package artifact size metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review', artifactSizeBytes: 1 });

            await expect(packageMarketplace(rootDir, { check: true })).rejects.toThrow(/artifact size/u);
        });
    });

    it('rejects archive paths that cannot fit the deterministic tar writer', async () => {
        await withTempMarketplace(async (rootDir) => {
            const packageRoot = path.join(rootDir, 'skills', 'repo-review');
            await mkdir(packageRoot, { recursive: true });
            await writeFile(path.join(packageRoot, 'a'.repeat(93)), 'too long for the tar name field\n', 'utf8');

            await expect(buildPackageArchive(packageRoot)).rejects.toThrow(/100 bytes/u);
        });
    });

    it('parses known CLI arguments strictly while accepting pnpm separators', () => {
        const cwd = path.resolve('marketplace-root');

        expect(resolveRootFromArgs(['--', '--check'], cwd)).toEqual({ rootDir: cwd, check: true });
        expect(resolveRootFromArgs(['--root', 'fixtures', '--check'], cwd)).toEqual({
            rootDir: path.resolve(cwd, 'fixtures'),
            check: true,
        });
        expect(() => resolveRootFromArgs(['--wat'], cwd)).toThrow(/Unknown arguments/u);
        expect(() => resolveRootFromArgs(['--root', '--check'], cwd)).toThrow(/Expected a path/u);
    });
});
