import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    buildGeneratedCatalog,
    checkGeneratedCatalog,
    deterministicSourceCommit,
    hashVendoredPackageDirectory,
    marketplaceRepositoryUrl,
    packageMarketplace,
    preparePagesOutput,
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
    upstreamRepositoryUrl?: string;
    upstreamRelativePath?: string;
    entryRelativePath?: string;
    writeEntry?: boolean;
    contentSha256?: string;
    sizeBytes?: number;
}

async function withTempMarketplace<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'neon-marketplace-'));
    try {
        await mkdir(path.join(rootDir, 'skills'), { recursive: true });
        await mkdir(path.join(rootDir, 'modes'), { recursive: true });
        await mkdir(path.join(rootDir, 'mcps'), { recursive: true });
        return await fn(rootDir);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
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
    const distributionRelativePath = `${kindRoot(input.kind)}/${input.slug}`;
    const contentDigest = await hashVendoredPackageDirectory(packageRoot);
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
            repositoryUrl: input.upstreamRepositoryUrl ?? 'https://github.com/example/source',
            commitSha: '0123456789abcdef0123456789abcdef01234567',
            relativePath: input.upstreamRelativePath ?? distributionRelativePath,
        },
        distribution: {
            repositoryUrl: marketplaceRepositoryUrl,
            commitSha: deterministicSourceCommit,
            relativePath: distributionRelativePath,
            contentSha256: input.contentSha256 ?? contentDigest.sha256,
            sizeBytes: input.sizeBytes ?? contentDigest.sizeBytes,
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
    it('accepts an empty marketplace and writes deterministic generated catalogs', async () => {
        await withTempMarketplace(async (rootDir) => {
            await writeGeneratedCatalog(rootDir);
            await checkGeneratedCatalog(rootDir);

            const catalog = JSON.parse(await readFile(path.join(rootDir, 'generated', 'catalog.v1.json'), 'utf8')) as {
                source: { repositoryUrl: string };
                packages: unknown[];
            };
            const modesCatalog = JSON.parse(await readFile(path.join(rootDir, 'generated', 'modes.v1.json'), 'utf8')) as {
                packages: unknown[];
            };
            expect(catalog.source.repositoryUrl).toBe(marketplaceRepositoryUrl);
            expect(catalog.packages).toEqual([]);
            expect(modesCatalog.packages).toEqual([]);
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

    it('writes split Pages catalogs with the requested marketplace commit', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, { kind: 'mcp', slug: 'local-files' });
            const sourceCommit = 'abcdef0123456789abcdef0123456789abcdef01';

            await preparePagesOutput({ rootDir, outputDir: '.pages', marketplaceCommitSha: sourceCommit });
            await preparePagesOutput({ rootDir, outputDir: '.pages', marketplaceCommitSha: sourceCommit, check: true });

            const skills = JSON.parse(await readFile(path.join(rootDir, '.pages', 'catalog', 'v1', 'skills.json'), 'utf8')) as {
                source: { commitSha: string };
                packages: Array<{ kind: string; distribution: { commitSha: string } }>;
            };
            const modes = JSON.parse(await readFile(path.join(rootDir, '.pages', 'catalog', 'v1', 'modes.json'), 'utf8')) as {
                packages: unknown[];
            };
            expect(skills.source.commitSha).toBe(sourceCommit);
            expect(skills.packages).toHaveLength(1);
            expect(skills.packages[0]?.kind).toBe('skill');
            expect(skills.packages[0]?.distribution.commitSha).toBe(sourceCommit);
            expect(modes.packages).toEqual([]);
        });
    });

    it('rejects duplicate package identities', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review-copy' });
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

    it('rejects unsafe paths and non-HTTPS upstream URLs', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                upstreamRepositoryUrl: 'http://example.com/repo',
            });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/HTTPS/u);
        });
    });

    it('rejects invalid content SHA and compatibility ranges', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const metadataPath = path.join(rootDir, 'skills', 'repo-review', 'marketplace.v1.json');
            const authored = JSON.parse(await readFile(metadataPath, 'utf8')) as {
                metadata: { distribution: { contentSha256: string }; compatibility: { neonVersionRange: string } };
            };
            authored.metadata.distribution.contentSha256 = 'abc';
            authored.metadata.compatibility.neonVersionRange = 'not a range';
            await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/SHA-256/u);
        });
    });

    it('rejects no-license and manual-review package status', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review', reviewStatus: 'blocked_no_license' });

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
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review', spdxExpression: 'GPL-3.0-only' });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/requires manual review/u);
        });
    });

    it('checks deterministic vendored package hashes against metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });

            const first = await packageMarketplace(rootDir, { check: true });
            const second = await packageMarketplace(rootDir, { check: true });
            expect(first).toEqual(second);
            expect(first[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
        });
    });

    it('rejects modified vendored content without updated hash metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await writeFile(path.join(rootDir, 'skills', 'repo-review', 'extra.md'), 'changed\n', 'utf8');

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/content SHA-256/u);
        });
    });

    it('rejects mismatched vendored package size metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review', sizeBytes: 1 });

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/content size/u);
        });
    });

    it('parses known CLI arguments strictly while accepting pnpm separators', () => {
        const cwd = path.resolve('marketplace-root');

        expect(resolveRootFromArgs(['--', '--check'], cwd)).toMatchObject({ rootDir: cwd, check: true });
        expect(resolveRootFromArgs(['--root', 'fixtures', '--check'], cwd)).toMatchObject({
            rootDir: path.resolve(cwd, 'fixtures'),
            check: true,
        });
        expect(resolveRootFromArgs(['--output', 'public', '--source-commit', 'abcdef0'], cwd)).toMatchObject({
            outputDir: 'public',
            sourceCommit: 'abcdef0',
        });
        expect(() => resolveRootFromArgs(['--wat'], cwd)).toThrow(/Unknown arguments/u);
        expect(() => resolveRootFromArgs(['--root', '--check'], cwd)).toThrow(/Expected a value/u);
    });
});
