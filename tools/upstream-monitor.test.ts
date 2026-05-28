import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    hashVendoredPackageDirectory,
    marketplaceRepositoryUrl,
    sha256File,
    validateMarketplace,
    writeGeneratedCatalog,
    type PackageKind,
} from './lib/marketplace.js';
import {
    buildUpstreamUpdateReport,
    parseUpstreamMonitorConfig,
    runUpstreamMonitor,
    type FetchLike,
    type UpstreamMonitorConfig,
} from './lib/upstream-monitor.js';

const oldCommitSha = '0123456789abcdef0123456789abcdef01234567';
const newCommitSha = 'abcdef0123456789abcdef0123456789abcdef01';

async function withTempMarketplace<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'neon-marketplace-upstream-'));
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
    return kind === 'skill' ? 'distribution/skills' : kind === 'mcp' ? 'distribution/mcps' : 'distribution/modes';
}

function entryName(kind: PackageKind): string {
    return kind === 'skill' ? 'SKILL.md' : kind === 'mcp' ? 'server.json' : 'mode.json';
}

async function addPackage(rootDir: string, input: { kind: 'skill' | 'mcp'; slug: string }): Promise<void> {
    const root = kindRoot(input.kind);
    const packageRoot = path.join(rootDir, root, input.slug);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, entryName(input.kind)), `${input.kind} old content\n`, 'utf8');
    await writeFile(path.join(packageRoot, 'LICENSE'), 'MIT License\n', 'utf8');
    const relativePackageRoot = `${root}/${input.slug}`;
    const digest = await hashVendoredPackageDirectory(packageRoot);
    const metadata = {
        kind: input.kind,
        slug: input.slug,
        version: '1.0.0',
        name: input.slug,
        summary: `${input.slug} package.`,
        source: {
            repositoryUrl: 'https://github.com/example/source',
            commitSha: oldCommitSha,
            relativePath: relativePackageRoot,
        },
        distribution: {
            repositoryUrl: marketplaceRepositoryUrl,
            commitSha: '0000000000000000000000000000000000000000',
            relativePath: relativePackageRoot,
            contentSha256: digest.sha256,
            sizeBytes: digest.sizeBytes,
        },
        compatibility: {
            neonVersionRange: '>=0.0.1 <1.0.0',
        },
        ...(input.kind === 'skill'
            ? { skill: { entryFile: `${relativePackageRoot}/SKILL.md` } }
            : { mcp: { manifestFile: `${relativePackageRoot}/server.json`, serverLabel: input.slug } }),
    };
    const authored = {
        schemaVersion: 1,
        metadata,
        compliance: {
            license: {
                spdxExpression: 'MIT',
                evidencePath: `${relativePackageRoot}/LICENSE`,
                evidenceSha256: await sha256File(path.join(packageRoot, 'LICENSE')),
                reviewStatus: 'approved',
                notices: [`Vendored from example/source at commit ${oldCommitSha}.`],
            },
        },
    };
    await writeFile(path.join(packageRoot, 'marketplace.v1.json'), `${JSON.stringify(authored, null, 4)}\n`, 'utf8');
}

function configFor(input: { kind: 'skill' | 'mcp'; slug: string }): UpstreamMonitorConfig {
    const root = kindRoot(input.kind);
    const entry = entryName(input.kind);
    return {
        schemaVersion: 1,
        packages: [
            {
                kind: input.kind,
                slug: input.slug,
                upstreamRepositoryUrl: 'https://github.com/example/source',
                upstreamRef: 'main',
                pinnedCommitSha: oldCommitSha,
                sourceRoot: `${root}/${input.slug}`,
                packageRoot: `${root}/${input.slug}`,
                files: [{ upstreamPath: `${root}/${input.slug}/${entry}`, packagePath: entry }],
                license: { upstreamPath: 'LICENSE', packagePath: 'LICENSE', spdxExpression: 'MIT' },
            },
        ],
    };
}

async function writeConfig(rootDir: string, config: UpstreamMonitorConfig): Promise<string> {
    const configPath = 'tools/upstream-monitor.v1.json';
    await mkdir(path.join(rootDir, 'tools'), { recursive: true });
    await writeFile(path.join(rootDir, configPath), `${JSON.stringify(config, null, 4)}\n`, 'utf8');
    return configPath;
}

function fetchFor(input: { commitSha: string; missingLicense?: boolean }): FetchLike {
    return async (url) => {
        if (url.includes('/commits/')) {
            return Response.json({ sha: input.commitSha });
        }
        if (url.endsWith('/LICENSE')) {
            return input.missingLicense ? new Response('missing', { status: 404 }) : new Response('MIT License\n');
        }
        if (url.endsWith('/SKILL.md')) {
            return new Response('skill new content\n');
        }
        if (url.endsWith('/server.json')) {
            return new Response('{"name":"server new content"}\n');
        }
        return new Response('missing', { status: 404 });
    };
}

describe('upstream update monitor', () => {
    it('parses monitor config and rejects mode packages', () => {
        expect(parseUpstreamMonitorConfig(configFor({ kind: 'skill', slug: 'repo-review' })).packages[0]?.slug).toBe(
            'repo-review'
        );
        expect(() =>
            parseUpstreamMonitorConfig({
                schemaVersion: 1,
                packages: [
                    {
                        ...configFor({ kind: 'skill', slug: 'repo-review' }).packages[0],
                        kind: 'mode',
                    },
                ],
            })
        ).toThrow(/supports skill and mcp/u);
    });

    it('reports current packages without writing updates', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const configPath = await writeConfig(rootDir, configFor({ kind: 'skill', slug: 'repo-review' }));

            const result = await runUpstreamMonitor({
                rootDir,
                configPath,
                check: true,
                fetchImpl: fetchFor({ commitSha: oldCommitSha }),
            });

            expect(result.packages).toEqual([
                expect.objectContaining({
                    identity: 'skill:repo-review',
                    status: 'current',
                    changedFiles: [],
                }),
            ]);
            expect(result.reportMarkdown).toContain('Status: current');
        });
    });

    it('reports available updates in check mode without modifying vendored files', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const configPath = await writeConfig(rootDir, configFor({ kind: 'skill', slug: 'repo-review' }));

            const result = await runUpstreamMonitor({
                rootDir,
                configPath,
                check: true,
                fetchImpl: fetchFor({ commitSha: newCommitSha }),
            });

            expect(result.packages[0]).toEqual(
                expect.objectContaining({
                    identity: 'skill:repo-review',
                    status: 'available',
                    changedFiles: [],
                })
            );
            await expect(readFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'SKILL.md'), 'utf8')).resolves.toBe(
                'skill old content\n'
            );
        });
    });

    it('updates a selected skill package and refreshes generated catalogs', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const configPath = await writeConfig(rootDir, configFor({ kind: 'skill', slug: 'repo-review' }));
            await writeGeneratedCatalog(rootDir);

            const result = await runUpstreamMonitor({
                rootDir,
                configPath,
                check: false,
                packageFilter: 'skill:repo-review',
                fetchImpl: fetchFor({ commitSha: newCommitSha }),
            });

            expect(result.packages[0]).toEqual(
                expect.objectContaining({
                    status: 'updated',
                    changedFiles: expect.arrayContaining([
                        'distribution/skills/repo-review/SKILL.md',
                        'distribution/skills/repo-review/marketplace.v1.json',
                    ]),
                })
            );
            await expect(readFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'SKILL.md'), 'utf8')).resolves.toBe(
                'skill new content\n'
            );
            const metadata = JSON.parse(
                await readFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'marketplace.v1.json'), 'utf8')
            ) as { metadata: { source: { commitSha: string } } };
            expect(metadata.metadata.source.commitSha).toBe(newCommitSha);
            await expect(validateMarketplace(rootDir)).resolves.toBeTruthy();
        });
    });

    it('updates an MCP package without changing activation behavior metadata', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'mcp', slug: 'github' });
            const configPath = await writeConfig(rootDir, configFor({ kind: 'mcp', slug: 'github' }));

            const result = await runUpstreamMonitor({
                rootDir,
                configPath,
                check: false,
                fetchImpl: fetchFor({ commitSha: newCommitSha }),
            });

            expect(result.packages[0]?.status).toBe('updated');
            const metadata = JSON.parse(await readFile(path.join(rootDir, 'distribution', 'mcps', 'github', 'marketplace.v1.json'), 'utf8')) as {
                metadata: { kind: string; mcp: { serverLabel: string } };
            };
            expect(metadata.metadata.kind).toBe('mcp');
            expect(metadata.metadata.mcp.serverLabel).toBe('github');
        });
    });

    it('blocks missing license evidence before modifying package files', async () => {
        await withTempMarketplace(async (rootDir) => {
            await addPackage(rootDir, { kind: 'skill', slug: 'repo-review' });
            const configPath = await writeConfig(rootDir, configFor({ kind: 'skill', slug: 'repo-review' }));

            const result = await runUpstreamMonitor({
                rootDir,
                configPath,
                check: false,
                fetchImpl: fetchFor({ commitSha: newCommitSha, missingLicense: true }),
            });

            expect(result.packages[0]?.status).toBe('blocked');
            expect(result.packages[0]?.riskFlags[0]).toMatch(/HTTP 404/u);
            await expect(readFile(path.join(rootDir, 'distribution', 'skills', 'repo-review', 'SKILL.md'), 'utf8')).resolves.toBe(
                'skill old content\n'
            );
        });
    });

    it('rejects unsafe paths and produces deterministic report markdown', () => {
        expect(() =>
            parseUpstreamMonitorConfig({
                schemaVersion: 1,
                packages: [
                    {
                        ...configFor({ kind: 'skill', slug: 'repo-review' }).packages[0],
                        files: [{ upstreamPath: '../SKILL.md', packagePath: 'SKILL.md' }],
                    },
                ],
            })
        ).toThrow(/safe relative path/u);

        expect(
            buildUpstreamUpdateReport([
                {
                    identity: 'skill:repo-review',
                    status: 'blocked',
                    oldCommitSha,
                    changedFiles: [],
                    riskFlags: ['license missing'],
                },
            ])
        ).toBe(
            [
                '# Marketplace Upstream Update Report',
                '',
                '## skill:repo-review',
                '',
                '- Status: blocked',
                `- Pinned commit: ${oldCommitSha}`,
                '- Risk flags:',
                '  - license missing',
                '',
            ].join('\n')
        );
    });
});
