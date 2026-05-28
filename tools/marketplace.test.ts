import { createHash } from 'node:crypto';
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
    validatePortableModeManifestJson,
    validateMarketplace,
    writeGeneratedCatalog,
    type LicenseReviewStatus,
    type PackageKind,
    type MarketplacePackageFileManifestEntry,
} from './lib/marketplace.js';
import {
    materializeSourceIntakePackage,
    parseSourceIntakeCatalog,
    validateSourceIntakeCatalogs,
} from './lib/source-intake.js';

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
        await mkdir(path.join(rootDir, 'distribution', 'skills'), { recursive: true });
        await mkdir(path.join(rootDir, 'distribution', 'modes'), { recursive: true });
        await mkdir(path.join(rootDir, 'distribution', 'mcps'), { recursive: true });
        return await fn(rootDir);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
}

function kindRoot(kind: PackageKind): string {
    if (kind === 'skill') {
        return 'distribution/skills';
    }
    if (kind === 'mode') {
        return 'distribution/modes';
    }
    return 'distribution/mcps';
}

function entryFileName(kind: PackageKind): string {
    if (kind === 'skill') {
        return 'SKILL.md';
    }
    if (kind === 'mode') {
        return 'mode.json';
    }
    return 'MCP.yaml';
}

function modeManifest(input: { authoringRole?: string; roleTemplate?: string; version?: number } = {}): string {
    return JSON.stringify({
        version: input.version ?? 2,
        slug: 'focused-implementer',
        name: 'Focused Implementer',
        authoringRole: input.authoringRole ?? 'single_task_agent',
        roleTemplate: input.roleTemplate ?? 'single_task_agent/apply',
        customInstructions: 'Implement one approved task at a time.',
    });
}

async function addPackage(rootDir: string, input: FixturePackageInput): Promise<string> {
    const version = input.version ?? '1.0.0';
    const packageRoot = path.join(rootDir, kindRoot(input.kind), input.slug);
    await mkdir(packageRoot, { recursive: true });
    const entryRelativePath = input.entryRelativePath ?? `${kindRoot(input.kind)}/${input.slug}/${entryFileName(input.kind)}`;
    const entryPath = path.join(rootDir, entryRelativePath);
    if (input.writeEntry !== false) {
        await mkdir(path.dirname(entryPath), { recursive: true });
        await writeFile(
            entryPath,
            input.kind === 'mode' ? modeManifest() : `${input.kind} fixture for ${input.slug}\n`,
            'utf8'
        );
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

function recomputePackageDigestFromManifest(files: MarketplacePackageFileManifestEntry[]): {
    sha256: string;
    sizeBytes: number;
} {
    const digest = createHash('sha256');
    let sizeBytes = 0;
    for (const file of files) {
        sizeBytes += file.sizeBytes;
        digest.update(file.relativePath, 'utf8');
        digest.update('\0');
        digest.update(String(file.sizeBytes), 'utf8');
        digest.update('\0');
        digest.update(file.sha256, 'utf8');
        digest.update('\n');
    }
    return {
        sha256: digest.digest('hex'),
        sizeBytes,
    };
}

describe('marketplace validation', () => {
    it('accepts an empty marketplace and writes ignored local generated catalogs', async () => {
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

    it('checks generated catalog determinism without tracked generated files', async () => {
        await withTempMarketplace(async (rootDir) => {
            await checkGeneratedCatalog(rootDir);
        });
    });

    it('accepts valid skill, mode, and MCP fixture packages', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, { kind: 'mode', slug: 'focused-implementer' });
            await addPackage(rootDir, { kind: 'mcp', slug: 'local-files' });

            const result = await validateMarketplace(rootDir);
            expect(result.packages.map((pkg) => pkg.metadata.kind)).toEqual(['mcp', 'mode', 'skill']);
            expect(buildGeneratedCatalog(result.generatedPackages).packages).toHaveLength(3);
            expect(result.packages[0]?.metadata.distribution.files).toBeUndefined();
            expect(result.generatedPackages).toHaveLength(3);
        });
    });

    it('generates deterministic package file manifests for selected-file installs', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await writeFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'references.md'), 'reference\n', 'utf8');
            const metadataPath = path.join(rootDir, 'distribution', 'skills', 'repo-review', 'marketplace.v1.json');
            const authored = JSON.parse(await readFile(metadataPath, 'utf8')) as {
                metadata: { distribution: { contentSha256: string; sizeBytes: number } };
            };
            const digest = await hashVendoredPackageDirectory(path.join(rootDir, 'distribution', 'skills', 'repo-review'));
            authored.metadata.distribution.contentSha256 = digest.sha256;
            authored.metadata.distribution.sizeBytes = digest.sizeBytes;
            await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');

            const result = await validateMarketplace(rootDir);
            const packageEntry = result.catalog.packages[0];
            expect(packageEntry?.kind).toBe('skill');
            const files = packageEntry?.distribution.files ?? [];
            expect(files.map((file) => file.relativePath)).toEqual(['LICENSE', 'references.md', 'SKILL.md']);
            expect(files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
            expect(files.every((file) => file.sizeBytes > 0)).toBe(true);
            expect(files.some((file) => file.relativePath === 'marketplace.v1.json')).toBe(false);

            const recomputed = recomputePackageDigestFromManifest(files);
            expect(recomputed).toEqual({
                sha256: packageEntry?.distribution.contentSha256,
                sizeBytes: packageEntry?.distribution.sizeBytes,
            });
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
                packages: Array<{
                    kind: string;
                    distribution: { commitSha: string; files: MarketplacePackageFileManifestEntry[] };
                }>;
            };
            const catalog = JSON.parse(await readFile(path.join(rootDir, '.pages', 'catalog', 'v1', 'catalog.json'), 'utf8')) as {
                packages: Array<{
                    kind: string;
                    distribution: { files: MarketplacePackageFileManifestEntry[] };
                }>;
            };
            const modes = JSON.parse(await readFile(path.join(rootDir, '.pages', 'catalog', 'v1', 'modes.json'), 'utf8')) as {
                packages: unknown[];
            };
            expect(skills.source.commitSha).toBe(sourceCommit);
            expect(skills.packages).toHaveLength(1);
            expect(skills.packages[0]?.kind).toBe('skill');
            expect(skills.packages[0]?.distribution.commitSha).toBe(sourceCommit);
            expect(skills.packages[0]?.distribution.files).toEqual(
                catalog.packages.find((pkg) => pkg.kind === 'skill')?.distribution.files
            );
            expect(modes.packages).toEqual([]);
        });
    });

    it('rejects duplicate package identities', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review-copy' });
            const copyMetadataPath = path.join(rootDir, 'distribution', 'skills', 'repo-review-copy', 'marketplace.v1.json');
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
                entryRelativePath: 'distribution/skills/repo-review/missing.md',
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
            const metadataPath = path.join(rootDir, 'distribution', 'skills', 'repo-review', 'marketplace.v1.json');
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

    it('accepts explicit reviewed unlicensed package evidence', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, {
                kind: 'skill',
                slug: 'repo-review',
                reviewStatus: 'approved_unlicensed',
                spdxExpression: 'UNLICENSED',
            });
            const metadataPath = path.join(rootDir, 'distribution', 'skills', 'repo-review', 'marketplace.v1.json');
            const authored = JSON.parse(await readFile(metadataPath, 'utf8')) as {
                metadata: { source: { commitSha: string } };
                compliance: { license: { notices: string[] } };
            };
            authored.compliance.license.notices = [
                `No license file was present at upstream commit ${authored.metadata.source.commitSha}.`,
            ];
            await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');

            await expect(validateMarketplace(rootDir)).resolves.toMatchObject({ packages: expect.any(Array) });
        });
    });

    it('validates portable mode v2 role templates before catalog publication', async () => {
        const validPairs = [
            ['chat', 'chat/default'],
            ['single_task_agent', 'single_task_agent/review'],
            ['orchestrator_primary', 'orchestrator_primary/orchestrate'],
            ['orchestrator_worker_agent', 'orchestrator_worker_agent/explorer'],
        ] as const;
        for (const [authoringRole, roleTemplate] of validPairs) {
            expect(() => validatePortableModeManifestJson(modeManifest({ authoringRole, roleTemplate }))).not.toThrow();
        }
        expect(() =>
            validatePortableModeManifestJson(modeManifest({ authoringRole: 'chat', roleTemplate: 'single_task_agent/apply' }))
        ).toThrow(/roleTemplate must match/u);
        expect(() => validatePortableModeManifestJson(modeManifest({ version: 1 }))).toThrow(/version 2/u);
        expect(() =>
            validatePortableModeManifestJson(
                JSON.stringify({
                    version: 2,
                    slug: 'bad-mode',
                    name: 'Bad Mode',
                    authoringRole: 'single_task_agent',
                    roleTemplate: 'single_task_agent/apply',
                    unknown: true,
                })
            )
        ).toThrow(/unexpected field/u);
    });

    it('rejects invalid mode packages during marketplace validation', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'mode', slug: 'focused-implementer' });
            await writeFile(
                path.join(rootDir, 'distribution', 'modes', 'focused-implementer', 'mode.json'),
                modeManifest({ authoringRole: 'orchestrator_primary', roleTemplate: 'single_task_agent/apply' }),
                'utf8'
            );

            await expect(validateMarketplace(rootDir)).rejects.toThrow(/roleTemplate must match/u);
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
            await writeFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'extra.md'), 'changed\n', 'utf8');

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

describe('source intake', () => {
    it('parses empty family source catalogs', () => {
        expect(parseSourceIntakeCatalog({ schemaVersion: 1, kind: 'skill', packages: [] })).toMatchObject({
            kind: 'skill',
            packages: [],
        });
    });

    it('materializes source-pull packages into vendored package metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            const sourceCatalog = parseSourceIntakeCatalog({
                schemaVersion: 1,
                kind: 'skill',
                packages: [
                    {
                        intake: 'source_pull',
                        kind: 'skill',
                        slug: 'repo-review',
                        version: '1.0.0',
                        name: 'Repo Review',
                        summary: 'Review repository changes.',
                        source: {
                            repositoryUrl: 'https://github.com/example/source',
                            commitSha: '0123456789abcdef0123456789abcdef01234567',
                            relativePath: 'skills/repo-review',
                        },
                        compatibility: {
                            neonVersionRange: '>=0.0.1 <1.0.0',
                        },
                        license: {
                            spdxExpression: 'MIT',
                            evidenceFile: 'LICENSE',
                            reviewStatus: 'approved',
                        },
                        files: [
                            { upstreamPath: 'skills/repo-review/SKILL.md', packagePath: 'SKILL.md' },
                            { upstreamPath: 'LICENSE', packagePath: 'LICENSE' },
                        ],
                        skill: {
                            entryFile: 'SKILL.md',
                        },
                    },
                ],
            });
            await materializeSourceIntakePackage({
                rootDir,
                catalogKind: sourceCatalog.kind,
                sourcePackage: sourceCatalog.packages[0]!,
                resolvedCommitSha: '0123456789abcdef0123456789abcdef01234567',
                files: [
                    { packagePath: 'SKILL.md', bytes: new TextEncoder().encode('Skill body\n') },
                    { packagePath: 'LICENSE', bytes: new TextEncoder().encode('MIT License\n') },
                ],
            });

            const result = await validateMarketplace(rootDir);
            expect(result.packages[0]?.metadata).toMatchObject({
                kind: 'skill',
                slug: 'repo-review',
                source: { commitSha: '0123456789abcdef0123456789abcdef01234567' },
                skill: { entryFile: 'distribution/skills/repo-review/SKILL.md' },
            });
        });
    });

    it('accepts reviewed unlicensed source entries and rejects mismatched status', () => {
        expect(() =>
            parseSourceIntakeCatalog({
                schemaVersion: 1,
                kind: 'skill',
                packages: [
                    {
                        intake: 'source_pull',
                        kind: 'skill',
                        slug: 'repo-review',
                        version: '1.0.0',
                        name: 'Repo Review',
                        summary: 'Review repository changes.',
                        source: {
                            repositoryUrl: 'https://github.com/example/source',
                            commitSha: '0123456789abcdef0123456789abcdef01234567',
                            relativePath: 'skills/repo-review',
                        },
                        compatibility: { neonVersionRange: '>=0.0.1 <1.0.0' },
                        license: {
                            spdxExpression: 'UNLICENSED',
                            evidenceFile: 'UNLICENSED.md',
                            reviewStatus: 'approved_unlicensed',
                            notices: ['No license file was present at upstream commit 0123456789abcdef0123456789abcdef01234567.'],
                        },
                        files: [{ upstreamPath: 'SKILL.md', packagePath: 'SKILL.md' }],
                        skill: { entryFile: 'SKILL.md' },
                    },
                ],
            })
        ).not.toThrow();
        expect(() =>
            parseSourceIntakeCatalog({
                schemaVersion: 1,
                kind: 'skill',
                packages: [
                    {
                        intake: 'source_pull',
                        kind: 'skill',
                        slug: 'repo-review',
                        version: '1.0.0',
                        name: 'Repo Review',
                        summary: 'Review repository changes.',
                        source: {
                            repositoryUrl: 'https://github.com/example/source',
                            commitSha: '0123456789abcdef0123456789abcdef01234567',
                            relativePath: 'skills/repo-review',
                        },
                        compatibility: { neonVersionRange: '>=0.0.1 <1.0.0' },
                        license: {
                            spdxExpression: 'MIT',
                            evidenceFile: 'UNLICENSED.md',
                            reviewStatus: 'approved_unlicensed',
                        },
                        files: [{ upstreamPath: 'SKILL.md', packagePath: 'SKILL.md' }],
                        skill: { entryFile: 'SKILL.md' },
                    },
                ],
            })
        ).toThrow(/UNLICENSED/u);
    });

    it('requires source package truth to use an upstream commit SHA', () => {
        expect(() =>
            parseSourceIntakeCatalog({
                schemaVersion: 1,
                kind: 'skill',
                packages: [
                    {
                        intake: 'source_pull',
                        kind: 'skill',
                        slug: 'repo-review',
                        version: '1.0.0',
                        name: 'Repo Review',
                        summary: 'Review repository changes.',
                        source: {
                            repositoryUrl: 'https://github.com/example/source',
                            ref: 'main',
                            relativePath: 'skills/repo-review',
                        },
                        compatibility: { neonVersionRange: '>=0.0.1 <1.0.0' },
                        license: {
                            spdxExpression: 'MIT',
                            evidenceFile: 'LICENSE',
                            reviewStatus: 'approved',
                        },
                        files: [{ upstreamPath: 'SKILL.md', packagePath: 'SKILL.md' }],
                        skill: { entryFile: 'SKILL.md' },
                    },
                ],
            })
        ).toThrow(/unexpected field|commitSha/u);
    });

    it('validates checked-in source catalog files', async () => {
        await withTempMarketplace(async (rootDir) => {
            await mkdir(path.join(rootDir, 'sources'), { recursive: true });
            await writeFile(path.join(rootDir, 'sources', 'skills.v1.json'), '{"schemaVersion":1,"kind":"skill","packages":[]}\n');
            await writeFile(path.join(rootDir, 'sources', 'mcps.v1.json'), '{"schemaVersion":1,"kind":"mcp","packages":[]}\n');
            await writeFile(path.join(rootDir, 'sources', 'modes.v1.json'), '{"schemaVersion":1,"kind":"mode","packages":[]}\n');

            await expect(validateSourceIntakeCatalogs(rootDir)).resolves.toHaveLength(3);
        });
    });
});
