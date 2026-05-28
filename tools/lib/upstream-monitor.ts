import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    hashVendoredPackageDirectory,
    loadAuthoredPackages,
    packageIdentity,
    parseAuthoredMarketplacePackage,
    sha256File,
    validateMarketplace,
    writeGeneratedCatalog,
    type AuthoredMarketplacePackage,
    type PackageKind,
} from './marketplace.js';

export const upstreamMonitorSchemaVersion = 1 as const;
export const defaultUpstreamMonitorConfigPath = 'tools/upstream-monitor.v1.json';
export const defaultUpstreamMonitorReportPath = '.marketplace-upstream-report.md';

const commitShaPattern = /^[a-f0-9]{7,64}$/u;
const fullCommitShaPattern = /^[a-f0-9]{40}$/u;
const allowedKinds = new Set<PackageKind>(['skill', 'mcp']);
const approvedLicenseExpressions = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);

export interface UpstreamMonitorConfig {
    schemaVersion: typeof upstreamMonitorSchemaVersion;
    packages: UpstreamMonitorPackage[];
}

export interface UpstreamMonitorPackage {
    kind: 'skill' | 'mcp';
    slug: string;
    upstreamRepositoryUrl: string;
    upstreamRef: string;
    pinnedCommitSha: string;
    sourceRoot: string;
    packageRoot: string;
    files: UpstreamMonitorFileMapping[];
    license: UpstreamMonitorLicenseMapping;
}

export interface UpstreamMonitorFileMapping {
    upstreamPath: string;
    packagePath: string;
}

export interface UpstreamMonitorLicenseMapping {
    upstreamPath: string;
    packagePath: string;
    spdxExpression: string;
}

export interface UpstreamMonitorOptions {
    rootDir: string;
    check: boolean;
    packageFilter?: string;
    configPath?: string;
    reportPath?: string;
    fetchImpl?: FetchLike;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface UpstreamMonitorRunResult {
    reportMarkdown: string;
    packages: UpstreamMonitorPackageResult[];
}

export interface UpstreamMonitorPackageResult {
    identity: string;
    status: 'current' | 'updated' | 'available' | 'blocked';
    oldCommitSha: string;
    newCommitSha?: string;
    changedFiles: string[];
    riskFlags: string[];
}

interface ResolvedGitHubRepository {
    owner: string;
    repo: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePathSeparators(value: string): string {
    return value.replace(/\\/gu, '/');
}

function readObject(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Invalid "${field}": expected object.`);
    }
    return value;
}

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Invalid "${field}": expected non-empty string.`);
    }
    return value;
}

function readArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid "${field}": expected array.`);
    }
    return value;
}

function assertAllowedKeys(source: Record<string, unknown>, allowedKeys: Set<string>, field: string): void {
    for (const key of Object.keys(source)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Invalid "${field}.${key}": unexpected field.`);
        }
    }
}

function readHttpsUrl(value: unknown, field: string): string {
    const text = readString(value, field);
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch (error) {
        throw new Error(`Invalid "${field}": expected URL.`, { cause: error });
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error(`Invalid "${field}": expected HTTPS URL without credentials.`);
    }
    return text;
}

function readSafeRelativePath(value: unknown, field: string): string {
    const relativePath = normalizePathSeparators(readString(value, field));
    const segments = relativePath.split('/');
    if (
        relativePath.includes('\\') ||
        relativePath.startsWith('/') ||
        /^[A-Za-z]:/u.test(relativePath) ||
        segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(`Invalid "${field}": expected safe relative path.`);
    }
    return relativePath;
}

function readCommitSha(value: unknown, field: string): string {
    const text = readString(value, field);
    if (!commitShaPattern.test(text)) {
        throw new Error(`Invalid "${field}": expected Git commit SHA.`);
    }
    return text;
}

function readKind(value: unknown, field: string): 'skill' | 'mcp' {
    const kind = readString(value, field);
    if (kind !== 'skill' && kind !== 'mcp') {
        throw new Error(`Invalid "${field}": upstream update monitoring supports skill and mcp packages only.`);
    }
    return kind;
}

function readFileMapping(value: unknown, field: string): UpstreamMonitorFileMapping {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['upstreamPath', 'packagePath']), field);
    return {
        upstreamPath: readSafeRelativePath(source.upstreamPath, `${field}.upstreamPath`),
        packagePath: readSafeRelativePath(source.packagePath, `${field}.packagePath`),
    };
}

function readLicenseMapping(value: unknown, field: string): UpstreamMonitorLicenseMapping {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['upstreamPath', 'packagePath', 'spdxExpression']), field);
    return {
        upstreamPath: readSafeRelativePath(source.upstreamPath, `${field}.upstreamPath`),
        packagePath: readSafeRelativePath(source.packagePath, `${field}.packagePath`),
        spdxExpression: readString(source.spdxExpression, `${field}.spdxExpression`),
    };
}

function readPackage(value: unknown, field: string): UpstreamMonitorPackage {
    const source = readObject(value, field);
    assertAllowedKeys(
        source,
        new Set([
            'kind',
            'slug',
            'upstreamRepositoryUrl',
            'upstreamRef',
            'pinnedCommitSha',
            'sourceRoot',
            'packageRoot',
            'files',
            'license',
        ]),
        field
    );
    const files = readArray(source.files, `${field}.files`).map((entry, index) =>
        readFileMapping(entry, `${field}.files[${String(index)}]`)
    );
    if (files.length === 0) {
        throw new Error(`Invalid "${field}.files": expected at least one file mapping.`);
    }
    return {
        kind: readKind(source.kind, `${field}.kind`),
        slug: readString(source.slug, `${field}.slug`),
        upstreamRepositoryUrl: readHttpsUrl(source.upstreamRepositoryUrl, `${field}.upstreamRepositoryUrl`),
        upstreamRef: readString(source.upstreamRef, `${field}.upstreamRef`),
        pinnedCommitSha: readCommitSha(source.pinnedCommitSha, `${field}.pinnedCommitSha`),
        sourceRoot: readSafeRelativePath(source.sourceRoot, `${field}.sourceRoot`),
        packageRoot: readSafeRelativePath(source.packageRoot, `${field}.packageRoot`),
        files,
        license: readLicenseMapping(source.license, `${field}.license`),
    };
}

export function parseUpstreamMonitorConfig(input: unknown): UpstreamMonitorConfig {
    const source = readObject(input, 'input');
    assertAllowedKeys(source, new Set(['schemaVersion', 'packages']), 'input');
    if (source.schemaVersion !== upstreamMonitorSchemaVersion) {
        throw new Error(`Invalid "schemaVersion": expected ${String(upstreamMonitorSchemaVersion)}.`);
    }
    const packages = readArray(source.packages, 'packages').map((entry, index) =>
        readPackage(entry, `packages[${String(index)}]`)
    );
    const identities = new Set<string>();
    for (const pkg of packages) {
        const identity = `${pkg.kind}:${pkg.slug}`;
        if (identities.has(identity)) {
            throw new Error(`Invalid "packages": duplicate monitor identity "${identity}".`);
        }
        identities.add(identity);
    }
    return {
        schemaVersion: upstreamMonitorSchemaVersion,
        packages,
    };
}

export async function loadUpstreamMonitorConfig(input: {
    rootDir: string;
    configPath?: string;
}): Promise<UpstreamMonitorConfig> {
    const configPath = path.resolve(input.rootDir, input.configPath ?? defaultUpstreamMonitorConfigPath);
    const json = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    return parseUpstreamMonitorConfig(json);
}

function parseGitHubRepositoryUrl(repositoryUrl: string): ResolvedGitHubRepository {
    const parsed = new URL(repositoryUrl);
    if (parsed.hostname !== 'github.com') {
        throw new Error(`Invalid upstream repository "${repositoryUrl}": expected github.com.`);
    }
    const [owner, repo, ...extra] = parsed.pathname.replace(/^\/+/u, '').split('/');
    if (!owner || !repo || extra.length > 0) {
        throw new Error(`Invalid upstream repository "${repositoryUrl}": expected owner/repo URL.`);
    }
    return { owner, repo };
}

function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
    if (fetchImpl) {
        return fetchImpl;
    }
    return fetch;
}

function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function readJsonResponse(fetchImpl: FetchLike, url: string): Promise<unknown> {
    const response = await fetchImpl(url, { headers: buildHeaders() });
    if (!response.ok) {
        throw new Error(`GitHub request failed with HTTP ${String(response.status)} for ${url}.`);
    }
    return response.json();
}

async function readTextResponse(fetchImpl: FetchLike, url: string): Promise<string> {
    const response = await fetchImpl(url, { headers: buildHeaders() });
    if (!response.ok) {
        throw new Error(`GitHub raw file request failed with HTTP ${String(response.status)} for ${url}.`);
    }
    return response.text();
}

async function resolveUpstreamCommit(input: {
    fetchImpl: FetchLike;
    packageConfig: UpstreamMonitorPackage;
}): Promise<string> {
    const repo = parseGitHubRepositoryUrl(input.packageConfig.upstreamRepositoryUrl);
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(input.packageConfig.upstreamRef)}`;
    const response = readObject(await readJsonResponse(input.fetchImpl, url), 'commit response');
    const sha = readString(response.sha, 'commit response.sha');
    if (!fullCommitShaPattern.test(sha)) {
        throw new Error(`Invalid upstream commit SHA for ${input.packageConfig.kind}:${input.packageConfig.slug}.`);
    }
    return sha;
}

function buildRawUrl(input: {
    repositoryUrl: string;
    commitSha: string;
    upstreamPath: string;
}): string {
    const repo = parseGitHubRepositoryUrl(input.repositoryUrl);
    return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${input.commitSha}/${input.upstreamPath}`;
}

function resolvePackagePath(input: {
    rootDir: string;
    packageRoot: string;
    packagePath: string;
}): string {
    const packageRoot = path.resolve(input.rootDir, input.packageRoot);
    const target = path.resolve(packageRoot, input.packagePath);
    if (target !== packageRoot && !target.startsWith(`${packageRoot}${path.sep}`)) {
        throw new Error(`Invalid package path "${input.packagePath}": path escapes package root.`);
    }
    return target;
}

function updateNotices(input: {
    notices: string[] | undefined;
    oldCommitSha: string;
    newCommitSha: string;
}): string[] | undefined {
    if (!input.notices) {
        return undefined;
    }
    return input.notices.map((notice) => notice.split(input.oldCommitSha).join(input.newCommitSha));
}

function assertMonitorMatchesAuthored(input: {
    monitor: UpstreamMonitorPackage;
    authored: AuthoredMarketplacePackage;
}): void {
    const metadata = input.authored.metadata;
    if (!allowedKinds.has(metadata.kind) || metadata.kind !== input.monitor.kind || metadata.slug !== input.monitor.slug) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: package identity mismatch.`);
    }
    if (metadata.source.repositoryUrl !== input.monitor.upstreamRepositoryUrl) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: upstream repository mismatch.`);
    }
    if (metadata.source.commitSha !== input.monitor.pinnedCommitSha) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: pinned commit mismatch.`);
    }
    if (metadata.source.relativePath !== input.monitor.sourceRoot) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: source root mismatch.`);
    }
    const packageRoot = normalizePathSeparators(path.relative(path.dirname(path.dirname(input.authored.packageRoot)), input.authored.packageRoot));
    if (metadata.distribution.relativePath !== input.monitor.packageRoot || metadata.distribution.relativePath !== packageRoot) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: package root mismatch.`);
    }
    if (
        input.authored.compliance.license.spdxExpression !== input.monitor.license.spdxExpression ||
        input.authored.compliance.license.reviewStatus !== 'approved' ||
        !approvedLicenseExpressions.has(input.authored.compliance.license.spdxExpression)
    ) {
        throw new Error(`Invalid monitor config for ${input.monitor.kind}:${input.monitor.slug}: license is not approved for automatic update.`);
    }
}

async function writePackageUpdate(input: {
    rootDir: string;
    monitor: UpstreamMonitorPackage;
    authored: AuthoredMarketplacePackage;
    newCommitSha: string;
    fetchImpl: FetchLike;
}): Promise<string[]> {
    const changedFiles: string[] = [];
    const allFiles = [...input.monitor.files, input.monitor.license];
    const downloadedFiles: Array<{ packagePath: string; text: string }> = [];
    for (const file of allFiles) {
        const text = await readTextResponse(
            input.fetchImpl,
            buildRawUrl({
                repositoryUrl: input.monitor.upstreamRepositoryUrl,
                commitSha: input.newCommitSha,
                upstreamPath: file.upstreamPath,
            })
        );
        downloadedFiles.push({ packagePath: file.packagePath, text });
    }
    for (const file of downloadedFiles) {
        const targetPath = resolvePackagePath({
            rootDir: input.rootDir,
            packageRoot: input.monitor.packageRoot,
            packagePath: file.packagePath,
        });
        const existing = await readFile(targetPath, 'utf8').catch(() => undefined);
        if (existing !== file.text) {
            await mkdir(path.dirname(targetPath), { recursive: true });
            await writeFile(targetPath, file.text, 'utf8');
            changedFiles.push(`${input.monitor.packageRoot}/${file.packagePath}`);
        }
    }

    const metadataPath = path.join(input.rootDir, input.monitor.packageRoot, 'marketplace.v1.json');
    const metadataJson = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown;
    const parsed = parseAuthoredMarketplacePackage({
        json: metadataJson,
        filePath: metadataPath,
        packageRoot: path.dirname(metadataPath),
    });
    const digest = await hashVendoredPackageDirectory(parsed.packageRoot);
    const licenseEvidencePath = path.join(input.rootDir, parsed.compliance.license.evidencePath);
    const next = {
        schemaVersion: parsed.schemaVersion,
        metadata: {
            ...parsed.metadata,
            source: {
                ...parsed.metadata.source,
                commitSha: input.newCommitSha,
            },
            distribution: {
                ...parsed.metadata.distribution,
                contentSha256: digest.sha256,
                sizeBytes: digest.sizeBytes,
            },
        },
        compliance: {
            ...parsed.compliance,
            license: {
                ...parsed.compliance.license,
                evidenceSha256: await sha256File(licenseEvidencePath),
                notices: updateNotices({
                    notices: parsed.compliance.license.notices,
                    oldCommitSha: input.authored.metadata.source.commitSha,
                    newCommitSha: input.newCommitSha,
                }),
            },
        },
    };
    const nextText = `${JSON.stringify(next, null, 4)}\n`;
    const currentText = await readFile(metadataPath, 'utf8');
    if (currentText !== nextText) {
        await writeFile(metadataPath, nextText, 'utf8');
        changedFiles.push(`${input.monitor.packageRoot}/marketplace.v1.json`);
    }
    return changedFiles.sort((left, right) => left.localeCompare(right));
}

async function verifyPackageUpdateFiles(input: {
    monitor: UpstreamMonitorPackage;
    newCommitSha: string;
    fetchImpl: FetchLike;
}): Promise<void> {
    const allFiles = [...input.monitor.files, input.monitor.license];
    for (const file of allFiles) {
        await readTextResponse(
            input.fetchImpl,
            buildRawUrl({
                repositoryUrl: input.monitor.upstreamRepositoryUrl,
                commitSha: input.newCommitSha,
                upstreamPath: file.upstreamPath,
            })
        );
    }
}

async function runPackageMonitor(input: {
    rootDir: string;
    monitor: UpstreamMonitorPackage;
    authoredByIdentity: Map<string, AuthoredMarketplacePackage>;
    check: boolean;
    fetchImpl: FetchLike;
}): Promise<UpstreamMonitorPackageResult> {
    const identity = `${input.monitor.kind}:${input.monitor.slug}`;
    const authored = input.authoredByIdentity.get(identity);
    if (!authored) {
        return {
            identity,
            status: 'blocked',
            oldCommitSha: input.monitor.pinnedCommitSha,
            changedFiles: [],
            riskFlags: ['configured package is missing from vendored marketplace metadata'],
        };
    }
    try {
        assertMonitorMatchesAuthored({ monitor: input.monitor, authored });
        const newCommitSha = await resolveUpstreamCommit({
            fetchImpl: input.fetchImpl,
            packageConfig: input.monitor,
        });
        if (newCommitSha === input.monitor.pinnedCommitSha) {
            return {
                identity,
                status: 'current',
                oldCommitSha: input.monitor.pinnedCommitSha,
                newCommitSha,
                changedFiles: [],
                riskFlags: [],
            };
        }
        if (input.check) {
            await verifyPackageUpdateFiles({
                monitor: input.monitor,
                newCommitSha,
                fetchImpl: input.fetchImpl,
            });
            return {
                identity,
                status: 'available',
                oldCommitSha: input.monitor.pinnedCommitSha,
                newCommitSha,
                changedFiles: [],
                riskFlags: ['update is available; run upstream:update to re-vendor and validate'],
            };
        }
        const changedFiles = await writePackageUpdate({
            rootDir: input.rootDir,
            monitor: input.monitor,
            authored,
            newCommitSha,
            fetchImpl: input.fetchImpl,
        });
        return {
            identity,
            status: 'updated',
            oldCommitSha: input.monitor.pinnedCommitSha,
            newCommitSha,
            changedFiles,
            riskFlags: [],
        };
    } catch (error) {
        return {
            identity,
            status: 'blocked',
            oldCommitSha: input.monitor.pinnedCommitSha,
            changedFiles: [],
            riskFlags: [error instanceof Error ? error.message : String(error)],
        };
    }
}

export function buildUpstreamUpdateReport(results: UpstreamMonitorPackageResult[]): string {
    const lines = ['# Marketplace Upstream Update Report', ''];
    for (const result of results) {
        lines.push(`## ${result.identity}`, '');
        lines.push(`- Status: ${result.status}`);
        lines.push(`- Pinned commit: ${result.oldCommitSha}`);
        if (result.newCommitSha) {
            lines.push(`- Upstream commit: ${result.newCommitSha}`);
        }
        if (result.changedFiles.length > 0) {
            lines.push('- Changed files:');
            for (const file of result.changedFiles) {
                lines.push(`  - ${file}`);
            }
        }
        if (result.riskFlags.length > 0) {
            lines.push('- Risk flags:');
            for (const flag of result.riskFlags) {
                lines.push(`  - ${flag}`);
            }
        }
        lines.push('');
    }
    return `${lines.join('\n').trimEnd()}\n`;
}

export async function runUpstreamMonitor(options: UpstreamMonitorOptions): Promise<UpstreamMonitorRunResult> {
    const config = await loadUpstreamMonitorConfig({
        rootDir: options.rootDir,
        ...(options.configPath ? { configPath: options.configPath } : {}),
    });
    const packages = await loadAuthoredPackages(options.rootDir);
    const authoredByIdentity = new Map(
        packages.map((pkg) => [`${pkg.metadata.kind}:${pkg.metadata.slug}`, pkg] as const)
    );
    const selectedPackages = options.packageFilter
        ? config.packages.filter((pkg) => `${pkg.kind}:${pkg.slug}` === options.packageFilter)
        : config.packages;
    if (options.packageFilter && selectedPackages.length === 0) {
        throw new Error(`Unknown monitored package "${options.packageFilter}".`);
    }
    const fetchImpl = resolveFetch(options.fetchImpl);
    const preflightResults: UpstreamMonitorPackageResult[] = [];
    for (const monitor of selectedPackages) {
        preflightResults.push(
            await runPackageMonitor({
                rootDir: options.rootDir,
                monitor,
                authoredByIdentity,
                check: true,
                fetchImpl,
            })
        );
    }
    const blockedResults = preflightResults.filter((result) => result.status === 'blocked');
    const availableResults = preflightResults.filter((result) => result.status === 'available');
    if (options.check || blockedResults.length > 0 || availableResults.length === 0) {
        const reportMarkdown = buildUpstreamUpdateReport(preflightResults);
        if (options.reportPath) {
            await writeFile(path.resolve(options.rootDir, options.reportPath), reportMarkdown, 'utf8');
        }
        return {
            reportMarkdown,
            packages: preflightResults,
        };
    }

    const availableIdentities = new Set(availableResults.map((result) => result.identity));
    const results: UpstreamMonitorPackageResult[] = [];
    for (const monitor of selectedPackages) {
        if (!availableIdentities.has(`${monitor.kind}:${monitor.slug}`)) {
            results.push(preflightResults.find((result) => result.identity === `${monitor.kind}:${monitor.slug}`)!);
            continue;
        }
        results.push(
            await runPackageMonitor({
                rootDir: options.rootDir,
                monitor,
                authoredByIdentity,
                check: false,
                fetchImpl,
            })
        );
    }
    if (!options.check && results.some((result) => result.status === 'updated')) {
        const configPath = path.resolve(options.rootDir, options.configPath ?? defaultUpstreamMonitorConfigPath);
        const currentConfig = parseUpstreamMonitorConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
        const nextConfig: UpstreamMonitorConfig = {
            schemaVersion: upstreamMonitorSchemaVersion,
            packages: currentConfig.packages.map((pkg) => {
                const result = results.find((candidate) => candidate.identity === `${pkg.kind}:${pkg.slug}`);
                return result?.status === 'updated' && result.newCommitSha
                    ? { ...pkg, pinnedCommitSha: result.newCommitSha }
                    : pkg;
            }),
        };
        await writeFile(configPath, `${JSON.stringify(nextConfig, null, 4)}\n`, 'utf8');
        await validateMarketplace(options.rootDir);
        await writeGeneratedCatalog(options.rootDir);
    }
    const reportMarkdown = buildUpstreamUpdateReport(results);
    if (options.reportPath) {
        await writeFile(path.resolve(options.rootDir, options.reportPath), reportMarkdown, 'utf8');
    }
    return {
        reportMarkdown,
        packages: results,
    };
}

export function resolveUpstreamMonitorArgs(args: string[], cwd: string): Omit<UpstreamMonitorOptions, 'fetchImpl'> {
    const normalizedArgs = args.filter((arg) => arg !== '--');
    let rootDir = cwd;
    let configPath: string | undefined;
    let reportPath: string | undefined;
    let packageFilter: string | undefined;
    const consumed = new Set<number>();
    const consumeValue = (index: number, flag: string): string => {
        const value = normalizedArgs[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Expected a value after ${flag}.`);
        }
        consumed.add(index);
        consumed.add(index + 1);
        return value;
    };
    const check = normalizedArgs.includes('--check');
    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const arg = normalizedArgs[index];
        if (arg === '--check') {
            consumed.add(index);
        } else if (arg === '--root') {
            rootDir = path.resolve(cwd, consumeValue(index, '--root'));
        } else if (arg === '--config') {
            configPath = consumeValue(index, '--config');
        } else if (arg === '--report') {
            reportPath = consumeValue(index, '--report');
        } else if (arg === '--package') {
            packageFilter = consumeValue(index, '--package');
            if (!/^(skill|mcp):[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(packageFilter)) {
                throw new Error('Invalid "--package": expected kind:slug for skill or mcp.');
            }
        }
    }
    const unknown = normalizedArgs.filter((_arg, index) => !consumed.has(index));
    if (unknown.length > 0) {
        throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
    }
    return {
        rootDir,
        check,
        ...(configPath ? { configPath } : {}),
        ...(reportPath ? { reportPath } : {}),
        ...(packageFilter ? { packageFilter } : {}),
    };
}
