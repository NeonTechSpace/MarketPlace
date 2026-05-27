import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validRange } from 'semver';

export const marketplaceCatalogSchemaVersion = 1 as const;
export const marketplaceRepositoryUrl = 'https://github.com/NeonTechSpace/MarketPlace-NC';
export const deterministicGeneratedAt = '1970-01-01T00:00:00.000Z';
export const deterministicSourceCommit = '0000000000000000000000000000000000000000';

export const packageKinds = ['skill', 'mode', 'mcp'] as const;
export type PackageKind = (typeof packageKinds)[number];

export const licenseReviewStatuses = [
    'approved',
    'manual_review',
    'blocked_no_license',
    'blocked_restricted',
    'blocked_unclear',
] as const;
export type LicenseReviewStatus = (typeof licenseReviewStatuses)[number];

const approvedLicenseExpressions = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);
const approvedNonCodeLicenseExpressions = new Set(['CC0-1.0']);
const sha256Pattern = /^[a-f0-9]{64}$/u;
const commitShaPattern = /^[a-f0-9]{7,64}$/u;

export interface MarketplaceCatalogSource {
    repositoryUrl: string;
    commitSha: string;
}

export interface MarketplacePackageUpstreamSource {
    repositoryUrl: string;
    commitSha: string;
    relativePath: string;
}

export interface MarketplacePackageFileManifestEntry {
    relativePath: string;
    sha256: string;
    sizeBytes: number;
}

export interface MarketplacePackageDistribution {
    repositoryUrl: string;
    commitSha: string;
    relativePath: string;
    contentSha256: string;
    sizeBytes: number;
    files?: MarketplacePackageFileManifestEntry[];
}

export interface MarketplacePackageCompatibility {
    neonVersionRange: string;
    requiredCapabilities?: string[];
}

export interface MarketplacePackageBaseMetadata {
    kind: PackageKind;
    slug: string;
    version: string;
    name: string;
    summary: string;
    description?: string;
    tags?: string[];
    source: MarketplacePackageUpstreamSource;
    distribution: MarketplacePackageDistribution;
    compatibility: MarketplacePackageCompatibility;
}

export interface MarketplaceSkillPackageMetadata extends MarketplacePackageBaseMetadata {
    kind: 'skill';
    skill: {
        entryFile: string;
    };
}

export interface MarketplaceModePackageMetadata extends MarketplacePackageBaseMetadata {
    kind: 'mode';
    mode: {
        manifestFile: string;
    };
}

export interface MarketplaceMcpPackageMetadata extends MarketplacePackageBaseMetadata {
    kind: 'mcp';
    mcp: {
        manifestFile: string;
        serverLabel: string;
    };
}

export type MarketplacePackageMetadata =
    | MarketplaceSkillPackageMetadata
    | MarketplaceModePackageMetadata
    | MarketplaceMcpPackageMetadata;

export interface MarketplacePackageLicenseCompliance {
    spdxExpression: string;
    evidencePath: string;
    evidenceSha256: string;
    reviewStatus: LicenseReviewStatus;
    notices?: string[];
}

export interface MarketplacePackageCompliance {
    license: MarketplacePackageLicenseCompliance;
}

export interface AuthoredMarketplacePackage {
    schemaVersion: typeof marketplaceCatalogSchemaVersion;
    metadata: MarketplacePackageMetadata;
    compliance: MarketplacePackageCompliance;
    filePath: string;
    packageRoot: string;
}

export interface MarketplaceGeneratedCatalog {
    schemaVersion: typeof marketplaceCatalogSchemaVersion;
    generatedAt: string;
    source: MarketplaceCatalogSource;
    packages: MarketplacePackageMetadata[];
}

export interface MarketplaceValidationResult {
    packages: AuthoredMarketplacePackage[];
    generatedPackages: MarketplacePackageMetadata[];
    catalog: MarketplaceGeneratedCatalog;
}

export interface PackageContentDigest {
    sha256: string;
    sizeBytes: number;
    files: MarketplacePackageFileManifestEntry[];
}

export interface PackageArtifactResult {
    packageIdentity: string;
    sha256: string;
    sizeBytes: number;
    files: MarketplacePackageFileManifestEntry[];
}

export interface ResolvedCliArgs {
    rootDir: string;
    check: boolean;
    sourceCommit: string;
    outputDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePathSeparators(value: string): string {
    return value.replace(/\\/gu, '/');
}

function assertAllowedKeys(source: Record<string, unknown>, allowedKeys: Set<string>, field: string): void {
    for (const key of Object.keys(source)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Invalid "${field}.${key}": unexpected field.`);
        }
    }
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

function readOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return readString(value, field);
}

function readOptionalNumber(value: unknown, field: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid "${field}": expected number.`);
    }
    return value;
}

function readArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid "${field}": expected array.`);
    }
    return value;
}

function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Array.from(new Set(readArray(value, field).map((entry, index) => readString(entry, `${field}[${index}]`))));
}

function readEnum<T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
    const text = readString(value, field);
    if (!values.includes(text)) {
        throw new Error(`Invalid "${field}": expected one of ${values.join(', ')}.`);
    }
    return text;
}

function readSchemaVersion(value: unknown, field: string): typeof marketplaceCatalogSchemaVersion {
    if (value !== marketplaceCatalogSchemaVersion) {
        throw new Error(`Invalid "${field}": expected ${String(marketplaceCatalogSchemaVersion)}.`);
    }
    return marketplaceCatalogSchemaVersion;
}

function isSemver(value: string): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value);
}

function readSlug(value: unknown, field: string): string {
    const slug = readString(value, field);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
        throw new Error(`Invalid "${field}": expected lowercase kebab-case slug.`);
    }
    return slug;
}

function readSemver(value: unknown, field: string): string {
    const version = readString(value, field);
    if (!isSemver(version)) {
        throw new Error(`Invalid "${field}": expected semantic version.`);
    }
    return version;
}

function readSha256(value: unknown, field: string): string {
    const sha256 = readString(value, field);
    if (!sha256Pattern.test(sha256)) {
        throw new Error(`Invalid "${field}": expected lowercase SHA-256 digest.`);
    }
    return sha256;
}

function readCommitSha(value: unknown, field: string): string {
    const commitSha = readString(value, field);
    if (!commitShaPattern.test(commitSha)) {
        throw new Error(`Invalid "${field}": expected Git commit SHA.`);
    }
    return commitSha;
}

function readHttpsUrl(value: unknown, field: string): string {
    const text = readString(value, field);
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch (error) {
        throw new Error(`Invalid "${field}": expected URL.`, { cause: error });
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Invalid "${field}": expected HTTPS URL.`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Invalid "${field}": URL credentials are not allowed.`);
    }
    return text;
}

function readRelativePath(value: unknown, field: string): string {
    const relativePath = normalizePathSeparators(readString(value, field));
    const segments = relativePath.split('/');
    if (
        relativePath.includes('\\') ||
        relativePath.startsWith('/') ||
        /^[A-Za-z]:/u.test(relativePath) ||
        segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(`Invalid "${field}": expected repository-relative path.`);
    }
    return relativePath;
}

function readPositiveInteger(value: unknown, field: string): number {
    const number = readOptionalNumber(value, field);
    if (number === undefined || !Number.isInteger(number) || number <= 0) {
        throw new Error(`Invalid "${field}": expected positive integer.`);
    }
    return number;
}

function readUpstreamSource(value: unknown, field: string): MarketplacePackageUpstreamSource {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['repositoryUrl', 'commitSha', 'relativePath']), field);
    return {
        repositoryUrl: readHttpsUrl(source.repositoryUrl, `${field}.repositoryUrl`),
        commitSha: readCommitSha(source.commitSha, `${field}.commitSha`),
        relativePath: readRelativePath(source.relativePath, `${field}.relativePath`),
    };
}

function readDistribution(value: unknown, field: string): MarketplacePackageDistribution {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['repositoryUrl', 'commitSha', 'relativePath', 'contentSha256', 'sizeBytes']), field);
    return {
        repositoryUrl: readHttpsUrl(source.repositoryUrl, `${field}.repositoryUrl`),
        commitSha: readCommitSha(source.commitSha, `${field}.commitSha`),
        relativePath: readRelativePath(source.relativePath, `${field}.relativePath`),
        contentSha256: readSha256(source.contentSha256, `${field}.contentSha256`),
        sizeBytes: readPositiveInteger(source.sizeBytes, `${field}.sizeBytes`),
    };
}

function readCompatibility(value: unknown, field: string): MarketplacePackageCompatibility {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['neonVersionRange', 'requiredCapabilities']), field);
    const neonVersionRange = readString(source.neonVersionRange, `${field}.neonVersionRange`);
    if (!validRange(neonVersionRange)) {
        throw new Error(`Invalid "${field}.neonVersionRange": expected semantic version range.`);
    }
    const requiredCapabilities = readOptionalStringArray(source.requiredCapabilities, `${field}.requiredCapabilities`);
    return {
        neonVersionRange,
        ...(requiredCapabilities && requiredCapabilities.length > 0 ? { requiredCapabilities } : {}),
    };
}

function readPackageMetadata(value: unknown, field: string): MarketplacePackageMetadata {
    const source = readObject(value, field);
    const kind = readEnum(source.kind, `${field}.kind`, packageKinds);
    const allowedKeys = new Set([
        'kind',
        'slug',
        'version',
        'name',
        'summary',
        'description',
        'tags',
        'source',
        'distribution',
        'compatibility',
        kind,
    ]);
    assertAllowedKeys(source, allowedKeys, field);
    const base = {
        kind,
        slug: readSlug(source.slug, `${field}.slug`),
        version: readSemver(source.version, `${field}.version`),
        name: readString(source.name, `${field}.name`),
        summary: readString(source.summary, `${field}.summary`),
        ...(() => {
            const description = readOptionalString(source.description, `${field}.description`);
            return description ? { description: description.replace(/\r\n?/gu, '\n') } : {};
        })(),
        ...(() => {
            const tags = readOptionalStringArray(source.tags, `${field}.tags`);
            return tags && tags.length > 0 ? { tags } : {};
        })(),
        source: readUpstreamSource(source.source, `${field}.source`),
        distribution: readDistribution(source.distribution, `${field}.distribution`),
        compatibility: readCompatibility(source.compatibility, `${field}.compatibility`),
    };
    if (kind === 'skill') {
        const skill = readObject(source.skill, `${field}.skill`);
        assertAllowedKeys(skill, new Set(['entryFile']), `${field}.skill`);
        return {
            ...base,
            kind,
            skill: {
                entryFile: readRelativePath(skill.entryFile, `${field}.skill.entryFile`),
            },
        };
    }
    if (kind === 'mode') {
        const mode = readObject(source.mode, `${field}.mode`);
        assertAllowedKeys(mode, new Set(['manifestFile']), `${field}.mode`);
        return {
            ...base,
            kind,
            mode: {
                manifestFile: readRelativePath(mode.manifestFile, `${field}.mode.manifestFile`),
            },
        };
    }
    const mcp = readObject(source.mcp, `${field}.mcp`);
    assertAllowedKeys(mcp, new Set(['manifestFile', 'serverLabel']), `${field}.mcp`);
    return {
        ...base,
        kind,
        mcp: {
            manifestFile: readRelativePath(mcp.manifestFile, `${field}.mcp.manifestFile`),
            serverLabel: readString(mcp.serverLabel, `${field}.mcp.serverLabel`),
        },
    };
}

function readLicenseCompliance(value: unknown, field: string): MarketplacePackageLicenseCompliance {
    const source = readObject(value, field);
    assertAllowedKeys(
        source,
        new Set(['spdxExpression', 'evidencePath', 'evidenceSha256', 'reviewStatus', 'notices']),
        field
    );
    const notices = readOptionalStringArray(source.notices, `${field}.notices`);
    return {
        spdxExpression: readString(source.spdxExpression, `${field}.spdxExpression`),
        evidencePath: readRelativePath(source.evidencePath, `${field}.evidencePath`),
        evidenceSha256: readSha256(source.evidenceSha256, `${field}.evidenceSha256`),
        reviewStatus: readEnum(source.reviewStatus, `${field}.reviewStatus`, licenseReviewStatuses),
        ...(notices && notices.length > 0 ? { notices } : {}),
    };
}

function readCompliance(value: unknown, field: string): MarketplacePackageCompliance {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['license']), field);
    return {
        license: readLicenseCompliance(source.license, `${field}.license`),
    };
}

export function parseAuthoredMarketplacePackage(input: {
    json: unknown;
    filePath: string;
    packageRoot: string;
}): AuthoredMarketplacePackage {
    const source = readObject(input.json, 'input');
    assertAllowedKeys(source, new Set(['schemaVersion', 'metadata', 'compliance']), 'input');
    return {
        schemaVersion: readSchemaVersion(source.schemaVersion, 'schemaVersion'),
        metadata: readPackageMetadata(source.metadata, 'metadata'),
        compliance: readCompliance(source.compliance, 'compliance'),
        filePath: input.filePath,
        packageRoot: input.packageRoot,
    };
}

export function packageIdentity(metadata: MarketplacePackageMetadata): string {
    return `${metadata.kind}:${metadata.slug}:${metadata.version}`;
}

function withMarketplaceCommit(
    metadata: MarketplacePackageMetadata,
    marketplaceCommitSha: string
): MarketplacePackageMetadata {
    return {
        ...metadata,
        distribution: {
            ...metadata.distribution,
            commitSha: marketplaceCommitSha,
        },
    } as MarketplacePackageMetadata;
}

function withDistributionFiles(
    metadata: MarketplacePackageMetadata,
    files: MarketplacePackageFileManifestEntry[]
): MarketplacePackageMetadata {
    return {
        ...metadata,
        distribution: {
            ...metadata.distribution,
            files,
        },
    } as MarketplacePackageMetadata;
}

export function buildGeneratedCatalog(
    packages: MarketplacePackageMetadata[],
    options: { marketplaceCommitSha?: string; kind?: PackageKind } = {}
): MarketplaceGeneratedCatalog {
    const marketplaceCommitSha = options.marketplaceCommitSha ?? deterministicSourceCommit;
    const filteredPackages =
        options.kind === undefined ? packages : packages.filter((metadata) => metadata.kind === options.kind);
    return {
        schemaVersion: marketplaceCatalogSchemaVersion,
        generatedAt: deterministicGeneratedAt,
        source: {
            repositoryUrl: marketplaceRepositoryUrl,
            commitSha: marketplaceCommitSha,
        },
        packages: filteredPackages
            .map((metadata) => withMarketplaceCommit(metadata, marketplaceCommitSha))
            .sort((left, right) => packageIdentity(left).localeCompare(packageIdentity(right))),
    };
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function collectMarketplaceFiles(rootDir: string): Promise<string[]> {
    async function walk(dirPath: string): Promise<string[]> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.jj') {
                continue;
            }
            const absolutePath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                results.push(...(await walk(absolutePath)));
            } else if (entry.isFile() && entry.name === 'marketplace.v1.json') {
                results.push(absolutePath);
            }
        }
        return results;
    }
    const roots = ['skills', 'modes', 'mcps'];
    const files: string[] = [];
    for (const root of roots) {
        const rootPath = path.join(rootDir, root);
        if (await pathExists(rootPath)) {
            files.push(...(await walk(rootPath)));
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function expectedKindFolder(kind: PackageKind): string {
    if (kind === 'skill') {
        return 'skills';
    }
    if (kind === 'mode') {
        return 'modes';
    }
    return 'mcps';
}

function packageEntryPath(metadata: MarketplacePackageMetadata): string {
    if (metadata.kind === 'skill') {
        return metadata.skill.entryFile;
    }
    if (metadata.kind === 'mode') {
        return metadata.mode.manifestFile;
    }
    return metadata.mcp.manifestFile;
}

function ensurePathWithinPackage(input: { packageRoot: string; relativePath: string; field: string }): void {
    const packageRoot = normalizePathSeparators(input.packageRoot);
    if (input.relativePath !== packageRoot && !input.relativePath.startsWith(`${packageRoot}/`)) {
        throw new Error(`Invalid "${input.field}": expected path inside package root "${packageRoot}".`);
    }
}

function validateLicensePolicy(pkg: AuthoredMarketplacePackage): void {
    const license = pkg.compliance.license;
    if (license.reviewStatus === 'approved') {
        const allowed =
            approvedLicenseExpressions.has(license.spdxExpression) ||
            approvedNonCodeLicenseExpressions.has(license.spdxExpression);
        if (!allowed) {
            throw new Error(
                `Invalid "${packageIdentity(pkg.metadata)}": license "${license.spdxExpression}" requires manual review.`
            );
        }
        return;
    }
    throw new Error(
        `Invalid "${packageIdentity(pkg.metadata)}": license review status "${license.reviewStatus}" blocks publication-ready validation.`
    );
}

async function collectPackageContentFiles(packageRoot: string): Promise<string[]> {
    async function walk(dirPath: string): Promise<string[]> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const absolutePath = path.join(dirPath, entry.name);
            const relativePath = normalizePathSeparators(path.relative(packageRoot, absolutePath));
            if (entry.name === 'marketplace.v1.json') {
                continue;
            }
            if (entry.isDirectory()) {
                results.push(...(await walk(absolutePath)));
            } else if (entry.isFile()) {
                results.push(relativePath);
            }
        }
        return results;
    }
    return walk(packageRoot);
}

export async function hashVendoredPackageDirectory(packageRoot: string): Promise<PackageContentDigest> {
    const files = await collectPackageContentFiles(packageRoot);
    if (files.length === 0) {
        throw new Error('Invalid package directory: expected at least one vendored content file.');
    }
    const digest = createHash('sha256');
    let sizeBytes = 0;
    const fileManifest: MarketplacePackageFileManifestEntry[] = [];
    for (const file of files) {
        const data = await readFile(path.join(packageRoot, file));
        const fileSha256 = createHash('sha256').update(data).digest('hex');
        sizeBytes += data.length;
        fileManifest.push({
            relativePath: file,
            sha256: fileSha256,
            sizeBytes: data.length,
        });
        digest.update(file, 'utf8');
        digest.update('\0');
        digest.update(String(data.length), 'utf8');
        digest.update('\0');
        digest.update(fileSha256, 'utf8');
        digest.update('\n');
    }
    return { sha256: digest.digest('hex'), sizeBytes, files: fileManifest };
}

async function validatePackagePaths(
    rootDir: string,
    pkg: AuthoredMarketplacePackage
): Promise<PackageContentDigest> {
    const relativePackageRoot = normalizePathSeparators(path.relative(rootDir, pkg.packageRoot));
    const expectedFolder = expectedKindFolder(pkg.metadata.kind);
    if (!relativePackageRoot.startsWith(`${expectedFolder}/`)) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": package kind does not match folder family.`);
    }
    if (pkg.metadata.distribution.repositoryUrl !== marketplaceRepositoryUrl) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": distribution.repositoryUrl must target MarketPlace-NC.`);
    }
    if (pkg.metadata.distribution.relativePath !== relativePackageRoot) {
        throw new Error(
            `Invalid "${packageIdentity(pkg.metadata)}": distribution.relativePath must equal "${relativePackageRoot}".`
        );
    }
    ensurePathWithinPackage({
        packageRoot: relativePackageRoot,
        relativePath: packageEntryPath(pkg.metadata),
        field: 'metadata entry path',
    });
    ensurePathWithinPackage({
        packageRoot: relativePackageRoot,
        relativePath: pkg.compliance.license.evidencePath,
        field: 'compliance.license.evidencePath',
    });
    const entryPath = path.join(rootDir, packageEntryPath(pkg.metadata));
    if (!(await pathExists(entryPath))) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": entry or manifest file does not exist.`);
    }
    const evidencePath = path.join(rootDir, pkg.compliance.license.evidencePath);
    if (!(await pathExists(evidencePath))) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": license evidence file does not exist.`);
    }
    const evidenceHash = await sha256File(evidencePath);
    if (evidenceHash !== pkg.compliance.license.evidenceSha256) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": license evidence SHA-256 does not match.`);
    }
    const contentDigest = await hashVendoredPackageDirectory(pkg.packageRoot);
    if (contentDigest.sha256 !== pkg.metadata.distribution.contentSha256) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": vendored package content SHA-256 does not match.`);
    }
    if (contentDigest.sizeBytes !== pkg.metadata.distribution.sizeBytes) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": vendored package content size does not match.`);
    }
    return contentDigest;
}

export async function loadAuthoredPackages(rootDir: string): Promise<AuthoredMarketplacePackage[]> {
    const files = await collectMarketplaceFiles(rootDir);
    const packages = await Promise.all(
        files.map(async (filePath) => {
            const text = await readFile(filePath, 'utf8');
            return parseAuthoredMarketplacePackage({
                json: JSON.parse(text) as unknown,
                filePath,
                packageRoot: path.dirname(filePath),
            });
        })
    );
    return packages.sort((left, right) => packageIdentity(left.metadata).localeCompare(packageIdentity(right.metadata)));
}

export async function validateMarketplace(rootDir: string): Promise<MarketplaceValidationResult> {
    const packages = await loadAuthoredPackages(rootDir);
    const identities = new Set<string>();
    const digestsByIdentity = new Map<string, PackageContentDigest>();
    for (const pkg of packages) {
        const identity = packageIdentity(pkg.metadata);
        if (identities.has(identity)) {
            throw new Error(`Invalid packages: duplicate package identity "${identity}".`);
        }
        identities.add(identity);
        validateLicensePolicy(pkg);
        digestsByIdentity.set(identity, await validatePackagePaths(rootDir, pkg));
    }
    const generatedPackages = packages.map((pkg) => {
        const digest = digestsByIdentity.get(packageIdentity(pkg.metadata));
        if (!digest) {
            throw new Error(`Invalid packages: missing content digest for "${packageIdentity(pkg.metadata)}".`);
        }
        return withDistributionFiles(pkg.metadata, digest.files);
    });
    const catalog = buildGeneratedCatalog(generatedPackages);
    return { packages, generatedPackages, catalog };
}

function generatedCatalogs(packages: MarketplacePackageMetadata[], marketplaceCommitSha?: string): Map<string, MarketplaceGeneratedCatalog> {
    const options = marketplaceCommitSha === undefined ? {} : { marketplaceCommitSha };
    return new Map([
        ['catalog.v1.json', buildGeneratedCatalog(packages, options)],
        ['skills.v1.json', buildGeneratedCatalog(packages, { ...options, kind: 'skill' })],
        ['mcps.v1.json', buildGeneratedCatalog(packages, { ...options, kind: 'mcp' })],
        ['modes.v1.json', buildGeneratedCatalog(packages, { ...options, kind: 'mode' })],
    ]);
}

export async function writeGeneratedCatalog(rootDir: string): Promise<MarketplaceGeneratedCatalog> {
    const { generatedPackages, catalog } = await validateMarketplace(rootDir);
    const outputRoot = path.join(rootDir, 'generated');
    await mkdir(outputRoot, { recursive: true });
    for (const [fileName, generatedCatalog] of generatedCatalogs(generatedPackages)) {
        await writeFile(path.join(outputRoot, fileName), `${JSON.stringify(generatedCatalog, null, 4)}\n`, 'utf8');
    }
    return catalog;
}

export async function checkGeneratedCatalog(rootDir: string): Promise<void> {
    const { generatedPackages } = await validateMarketplace(rootDir);
    const outputRoot = path.join(rootDir, 'generated');
    for (const [fileName, generatedCatalog] of generatedCatalogs(generatedPackages)) {
        const actual = await readFile(path.join(outputRoot, fileName), 'utf8');
        const expected = `${JSON.stringify(generatedCatalog, null, 4)}\n`;
        if (actual !== expected) {
            throw new Error(`Generated catalog "${fileName}" is stale. Run \`pnpm run generate\`.`);
        }
    }
}

export async function preparePagesOutput(input: {
    rootDir: string;
    outputDir: string;
    marketplaceCommitSha: string;
    check?: boolean;
}): Promise<void> {
    const { generatedPackages } = await validateMarketplace(input.rootDir);
    const outputRoot = path.resolve(input.rootDir, input.outputDir);
    const catalogRoot = path.join(outputRoot, 'catalog', 'v1');
    const outputs = new Map([
        ['catalog.json', buildGeneratedCatalog(generatedPackages, { marketplaceCommitSha: input.marketplaceCommitSha })],
        ['skills.json', buildGeneratedCatalog(generatedPackages, { marketplaceCommitSha: input.marketplaceCommitSha, kind: 'skill' })],
        ['mcps.json', buildGeneratedCatalog(generatedPackages, { marketplaceCommitSha: input.marketplaceCommitSha, kind: 'mcp' })],
        ['modes.json', buildGeneratedCatalog(generatedPackages, { marketplaceCommitSha: input.marketplaceCommitSha, kind: 'mode' })],
    ]);
    if (input.check) {
        for (const [fileName, catalog] of outputs) {
            const actual = await readFile(path.join(catalogRoot, fileName), 'utf8');
            const expected = `${JSON.stringify(catalog, null, 4)}\n`;
            if (actual !== expected) {
                throw new Error(`Pages catalog "${fileName}" is stale. Run \`pnpm run pages\`.`);
            }
        }
        return;
    }
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(catalogRoot, { recursive: true });
    for (const [fileName, catalog] of outputs) {
        await writeFile(path.join(catalogRoot, fileName), `${JSON.stringify(catalog, null, 4)}\n`, 'utf8');
    }
}

export async function sha256File(filePath: string): Promise<string> {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function packageMarketplace(rootDir: string, options: { check?: boolean } = {}): Promise<PackageArtifactResult[]> {
    const { packages } = await validateMarketplace(rootDir);
    return Promise.all(
        packages.map(async (pkg) => {
            const digest = await hashVendoredPackageDirectory(pkg.packageRoot);
            if (options.check) {
                if (digest.sha256 !== pkg.metadata.distribution.contentSha256) {
                    throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": vendored package content SHA-256 does not match.`);
                }
                if (digest.sizeBytes !== pkg.metadata.distribution.sizeBytes) {
                    throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": vendored package content size does not match.`);
                }
            }
            return {
                packageIdentity: packageIdentity(pkg.metadata),
                sha256: digest.sha256,
                sizeBytes: digest.sizeBytes,
                files: digest.files,
            };
        })
    );
}

export function resolveRootFromArgs(args: string[], cwd: string): ResolvedCliArgs {
    const normalizedArgs = args.filter((arg) => arg !== '--');
    let rootDir = cwd;
    let outputDir = '.marketplace-pages';
    let sourceCommit = deterministicSourceCommit;
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
        } else if (arg === '--output') {
            outputDir = consumeValue(index, '--output');
        } else if (arg === '--source-commit') {
            sourceCommit = readCommitSha(consumeValue(index, '--source-commit'), '--source-commit');
        }
    }
    const unknown = normalizedArgs.filter((_arg, index) => !consumed.has(index));
    if (unknown.length > 0) {
        throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
    }
    return { rootDir, check, sourceCommit, outputDir };
}
