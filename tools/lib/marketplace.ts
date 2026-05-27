import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { validRange } from 'semver';

export const marketplaceCatalogSchemaVersion = 1 as const;
export const marketplaceRepositoryUrl = 'https://github.com/NeonTechSpace/MarketPlace';
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

export interface MarketplacePackageSource {
    repositoryUrl: string;
    relativePath: string;
}

export interface MarketplacePackageArtifact {
    url: string;
    sha256: string;
    sizeBytes?: number;
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
    source: MarketplacePackageSource;
    artifact: MarketplacePackageArtifact;
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
    sourceCommitSha: string;
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
    catalog: MarketplaceGeneratedCatalog;
}

export interface PackageArtifactResult {
    packageIdentity: string;
    fileName: string;
    sha256: string;
    sizeBytes: number;
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

function readOptionalPositiveInteger(value: unknown, field: string): number | undefined {
    const number = readOptionalNumber(value, field);
    if (number === undefined) {
        return undefined;
    }
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`Invalid "${field}": expected positive integer.`);
    }
    return number;
}

function readPackageSource(value: unknown, field: string): MarketplacePackageSource {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['repositoryUrl', 'relativePath']), field);
    return {
        repositoryUrl: readHttpsUrl(source.repositoryUrl, `${field}.repositoryUrl`),
        relativePath: readRelativePath(source.relativePath, `${field}.relativePath`),
    };
}

function readArtifact(value: unknown, field: string): MarketplacePackageArtifact {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['url', 'sha256', 'sizeBytes']), field);
    const sizeBytes = readOptionalPositiveInteger(source.sizeBytes, `${field}.sizeBytes`);
    return {
        url: readHttpsUrl(source.url, `${field}.url`),
        sha256: readSha256(source.sha256, `${field}.sha256`),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
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
        'artifact',
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
        source: readPackageSource(source.source, `${field}.source`),
        artifact: readArtifact(source.artifact, `${field}.artifact`),
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
    assertAllowedKeys(source, new Set(['sourceCommitSha', 'license']), field);
    return {
        sourceCommitSha: readCommitSha(source.sourceCommitSha, `${field}.sourceCommitSha`),
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

export function buildGeneratedCatalog(packages: MarketplacePackageMetadata[]): MarketplaceGeneratedCatalog {
    return {
        schemaVersion: marketplaceCatalogSchemaVersion,
        generatedAt: deterministicGeneratedAt,
        source: {
            repositoryUrl: marketplaceRepositoryUrl,
            commitSha: deterministicSourceCommit,
        },
        packages: [...packages].sort((left, right) => packageIdentity(left).localeCompare(packageIdentity(right))),
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

async function validatePackagePaths(rootDir: string, pkg: AuthoredMarketplacePackage): Promise<void> {
    const relativePackageRoot = normalizePathSeparators(path.relative(rootDir, pkg.packageRoot));
    const expectedFolder = expectedKindFolder(pkg.metadata.kind);
    if (!relativePackageRoot.startsWith(`${expectedFolder}/`)) {
        throw new Error(`Invalid "${packageIdentity(pkg.metadata)}": package kind does not match folder family.`);
    }
    if (pkg.metadata.source.relativePath !== relativePackageRoot) {
        throw new Error(
            `Invalid "${packageIdentity(pkg.metadata)}": source.relativePath must equal "${relativePackageRoot}".`
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
    for (const pkg of packages) {
        const identity = packageIdentity(pkg.metadata);
        if (identities.has(identity)) {
            throw new Error(`Invalid packages: duplicate package identity "${identity}".`);
        }
        identities.add(identity);
        validateLicensePolicy(pkg);
        await validatePackagePaths(rootDir, pkg);
    }
    const catalog = buildGeneratedCatalog(packages.map((pkg) => pkg.metadata));
    return { packages, catalog };
}

export async function writeGeneratedCatalog(rootDir: string): Promise<MarketplaceGeneratedCatalog> {
    const { catalog } = await validateMarketplace(rootDir);
    const outputPath = path.join(rootDir, 'generated', 'catalog.v1.json');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(catalog, null, 4)}\n`, 'utf8');
    return catalog;
}

export async function checkGeneratedCatalog(rootDir: string): Promise<void> {
    const { catalog } = await validateMarketplace(rootDir);
    const outputPath = path.join(rootDir, 'generated', 'catalog.v1.json');
    const actual = await readFile(outputPath, 'utf8');
    const expected = `${JSON.stringify(catalog, null, 4)}\n`;
    if (actual !== expected) {
        throw new Error('Generated catalog is stale. Run `pnpm run generate`.');
    }
}

export async function sha256File(filePath: string): Promise<string> {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function tarHeader(input: { name: string; size: number; type: '0' | '5' }): Buffer {
    const buffer = Buffer.alloc(512, 0);
    const write = (text: string, offset: number, length: number): void => {
        buffer.write(text.slice(0, length), offset, length, 'ascii');
    };
    const writeOctal = (value: number, offset: number, length: number): void => {
        const text = value.toString(8).padStart(length - 1, '0');
        write(`${text}\0`, offset, length);
    };
    write(input.name, 0, 100);
    writeOctal(input.type === '5' ? 0o755 : 0o644, 100, 8);
    writeOctal(0, 108, 8);
    writeOctal(0, 116, 8);
    writeOctal(input.size, 124, 12);
    writeOctal(0, 136, 12);
    buffer.fill(0x20, 148, 156);
    write(input.type, 156, 1);
    write('ustar', 257, 6);
    write('00', 263, 2);
    const checksum = buffer.reduce((sum, byte) => sum + byte, 0);
    write(checksum.toString(8).padStart(6, '0'), 148, 6);
    buffer[154] = 0;
    buffer[155] = 0x20;
    return buffer;
}

function assertSupportedTarName(name: string): void {
    if (!/^[\x20-\x7E]+$/u.test(name)) {
        throw new Error(`Unsupported package archive path "${name}": tar paths must be ASCII.`);
    }
    if (Buffer.byteLength(name, 'ascii') > 100) {
        throw new Error(`Unsupported package archive path "${name}": tar paths must be 100 bytes or fewer.`);
    }
}

async function collectPackageArchiveEntries(packageRoot: string): Promise<Array<{ name: string; data?: Buffer }>> {
    async function walk(dirPath: string): Promise<Array<{ name: string; data?: Buffer }>> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const results: Array<{ name: string; data?: Buffer }> = [];
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const absolutePath = path.join(dirPath, entry.name);
            const relativePath = normalizePathSeparators(path.relative(packageRoot, absolutePath));
            if (entry.name === 'marketplace.v1.json') {
                continue;
            }
            if (entry.isDirectory()) {
                results.push({ name: `${relativePath}/` });
                results.push(...(await walk(absolutePath)));
            } else if (entry.isFile()) {
                results.push({ name: relativePath, data: await readFile(absolutePath) });
            }
        }
        return results;
    }
    return walk(packageRoot);
}

export async function buildPackageArchive(packageRoot: string): Promise<Buffer> {
    const entries = await collectPackageArchiveEntries(packageRoot);
    const chunks: Buffer[] = [];
    for (const entry of entries) {
        const data = entry.data ?? Buffer.alloc(0);
        const archiveName = `package/${entry.name}`;
        assertSupportedTarName(archiveName);
        chunks.push(tarHeader({ name: archiveName, size: data.length, type: entry.name.endsWith('/') ? '5' : '0' }));
        if (data.length > 0) {
            chunks.push(data);
            const padding = (512 - (data.length % 512)) % 512;
            if (padding > 0) {
                chunks.push(Buffer.alloc(padding, 0));
            }
        }
    }
    chunks.push(Buffer.alloc(1024, 0));
    return gzipSync(Buffer.concat(chunks), { level: 9 });
}

export async function packageMarketplace(rootDir: string, options: { check?: boolean } = {}): Promise<PackageArtifactResult[]> {
    const { packages } = await validateMarketplace(rootDir);
    const artifactsRoot = path.join(rootDir, '.marketplace-artifacts');
    if (!options.check) {
        await mkdir(artifactsRoot, { recursive: true });
    }
    const results: PackageArtifactResult[] = [];
    for (const pkg of packages) {
        const archive = await buildPackageArchive(pkg.packageRoot);
        const sha256 = createHash('sha256').update(archive).digest('hex');
        const fileName = `${pkg.metadata.kind}-${pkg.metadata.slug}-${pkg.metadata.version}.tgz`;
        const result = {
            packageIdentity: packageIdentity(pkg.metadata),
            fileName,
            sha256,
            sizeBytes: archive.length,
        };
        if (options.check) {
            if (sha256 !== pkg.metadata.artifact.sha256) {
                throw new Error(`Invalid "${result.packageIdentity}": package artifact SHA-256 does not match metadata.`);
            }
            if (
                pkg.metadata.artifact.sizeBytes !== undefined &&
                archive.length !== pkg.metadata.artifact.sizeBytes
            ) {
                throw new Error(`Invalid "${result.packageIdentity}": package artifact size does not match metadata.`);
            }
        }
        if (!options.check) {
            await writeFile(path.join(artifactsRoot, fileName), archive);
        }
        results.push(result);
    }
    return results;
}

export function resolveRootFromArgs(args: string[], cwd: string): { rootDir: string; check: boolean } {
    const normalizedArgs = args.filter((arg) => arg !== '--');
    const check = normalizedArgs.includes('--check');
    const rootIndex = normalizedArgs.indexOf('--root');
    const rootValueIndex = rootIndex === -1 ? -1 : rootIndex + 1;
    const unknown = normalizedArgs.filter(
        (arg, index) => arg !== '--check' && arg !== '--root' && index !== rootValueIndex
    );
    if (unknown.length > 0) {
        throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
    }
    if (rootIndex === -1) {
        return { rootDir: cwd, check };
    }
    const root = normalizedArgs[rootValueIndex];
    if (!root || root.startsWith('--')) {
        throw new Error('Expected a path after --root.');
    }
    return { rootDir: path.resolve(cwd, root), check };
}
