import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    hashVendoredPackageDirectory,
    licenseReviewStatuses,
    marketplaceCatalogSchemaVersion,
    marketplaceRepositoryUrl,
    packageKinds,
    type AuthoredMarketplacePackage,
    type LicenseReviewStatus,
    type MarketplacePackageCompatibility,
    type MarketplacePackageMetadata,
    type PackageKind,
} from './marketplace.js';

export const sourceIntakeCatalogSchemaVersion = 1 as const;
export const sourceIntakeKinds = ['source_pull', 'manual_vendored'] as const;

export type SourceIntakeKind = (typeof sourceIntakeKinds)[number];

export interface SourceIntakeFileMapping {
    upstreamPath: string;
    packagePath: string;
}

export interface SourceIntakeSource {
    repositoryUrl: string;
    commitSha: string;
    relativePath: string;
}

export interface SourceIntakeLicense {
    spdxExpression: string;
    evidenceFile: string;
    reviewStatus: LicenseReviewStatus;
    notices?: string[];
}

export interface SourceIntakeBasePackage {
    intake: SourceIntakeKind;
    kind: PackageKind;
    slug: string;
    version: string;
    name: string;
    summary: string;
    description?: string;
    tags?: string[];
    source: SourceIntakeSource;
    compatibility: MarketplacePackageCompatibility;
    license: SourceIntakeLicense;
}

export interface SourceIntakeSkillPackage extends SourceIntakeBasePackage {
    kind: 'skill';
    files: SourceIntakeFileMapping[];
    skill: {
        entryFile: string;
    };
}

export interface SourceIntakeModePackage extends SourceIntakeBasePackage {
    kind: 'mode';
    files: SourceIntakeFileMapping[];
    mode: {
        manifestFile: string;
    };
}

export interface SourceIntakeMcpPackage extends SourceIntakeBasePackage {
    kind: 'mcp';
    files: SourceIntakeFileMapping[];
    mcp: {
        manifestFile: string;
        serverLabel: string;
    };
}

export type SourceIntakePackage =
    | SourceIntakeSkillPackage
    | SourceIntakeModePackage
    | SourceIntakeMcpPackage;

export interface SourceIntakeCatalog {
    schemaVersion: typeof sourceIntakeCatalogSchemaVersion;
    kind: PackageKind;
    packages: SourceIntakePackage[];
}

export interface SourceFileBytes {
    packagePath: string;
    bytes: Uint8Array;
}

export interface MaterializeSourcePackageInput {
    rootDir: string;
    catalogKind: PackageKind;
    sourcePackage: SourceIntakePackage;
    resolvedCommitSha: string;
    files: SourceFileBytes[];
}

const commitShaPattern = /^[a-f0-9]{7,64}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

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

function readArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid "${field}": expected array.`);
    }
    return value;
}

function readEnum<T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
    const text = readString(value, field);
    if (!values.includes(text)) {
        throw new Error(`Invalid "${field}": expected one of ${values.join(', ')}.`);
    }
    return text;
}

function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    const values = Array.from(new Set(readArray(value, field).map((entry, index) => readString(entry, `${field}[${index}]`))));
    return values.length > 0 ? values : undefined;
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

function readCommitSha(value: unknown, field: string): string {
    const commitSha = readString(value, field);
    if (!commitShaPattern.test(commitSha)) {
        throw new Error(`Invalid "${field}": expected Git commit SHA.`);
    }
    return commitSha;
}

function readSemver(value: unknown, field: string): string {
    const version = readString(value, field);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
        throw new Error(`Invalid "${field}": expected semantic version.`);
    }
    return version;
}

function readSlug(value: unknown, field: string): string {
    const slug = readString(value, field);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
        throw new Error(`Invalid "${field}": expected lowercase kebab-case slug.`);
    }
    return slug;
}

function readSource(value: unknown, field: string): SourceIntakeSource {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['repositoryUrl', 'commitSha', 'relativePath']), field);
    return {
        repositoryUrl: readHttpsUrl(source.repositoryUrl, `${field}.repositoryUrl`),
        commitSha: readCommitSha(source.commitSha, `${field}.commitSha`),
        relativePath: readRelativePath(source.relativePath, `${field}.relativePath`),
    };
}

function readFileMapping(value: unknown, field: string): SourceIntakeFileMapping {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['upstreamPath', 'packagePath']), field);
    return {
        upstreamPath: readRelativePath(source.upstreamPath, `${field}.upstreamPath`),
        packagePath: readRelativePath(source.packagePath, `${field}.packagePath`),
    };
}

function readCompatibility(value: unknown, field: string): MarketplacePackageCompatibility {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['neonVersionRange', 'requiredCapabilities']), field);
    const requiredCapabilities = readOptionalStringArray(source.requiredCapabilities, `${field}.requiredCapabilities`);
    return {
        neonVersionRange: readString(source.neonVersionRange, `${field}.neonVersionRange`),
        ...(requiredCapabilities ? { requiredCapabilities } : {}),
    };
}

function readLicense(value: unknown, field: string): SourceIntakeLicense {
    const source = readObject(value, field);
    assertAllowedKeys(source, new Set(['spdxExpression', 'evidenceFile', 'reviewStatus', 'notices']), field);
    const reviewStatus = readEnum(source.reviewStatus, `${field}.reviewStatus`, licenseReviewStatuses);
    const spdxExpression = readString(source.spdxExpression, `${field}.spdxExpression`);
    if (reviewStatus === 'approved_unlicensed' && spdxExpression !== 'UNLICENSED') {
        throw new Error(`Invalid "${field}.spdxExpression": approved_unlicensed packages must use UNLICENSED.`);
    }
    const notices = readOptionalStringArray(source.notices, `${field}.notices`);
    return {
        spdxExpression,
        evidenceFile: readRelativePath(source.evidenceFile, `${field}.evidenceFile`),
        reviewStatus,
        ...(notices ? { notices } : {}),
    };
}

function readBasePackage(value: unknown, field: string): Omit<SourceIntakeBasePackage, 'kind'> & { kind: PackageKind } {
    const source = readObject(value, field);
    const kind = readEnum(source.kind, `${field}.kind`, packageKinds);
    assertAllowedKeys(
        source,
        new Set([
            'intake',
            'kind',
            'slug',
            'version',
            'name',
            'summary',
            'description',
            'tags',
            'source',
            'compatibility',
            'license',
            'files',
            'skill',
            'mode',
            'mcp',
        ]),
        field
    );
    const description = readOptionalString(source.description, `${field}.description`);
    const tags = readOptionalStringArray(source.tags, `${field}.tags`);
    return {
        intake: readEnum(source.intake, `${field}.intake`, sourceIntakeKinds),
        kind,
        slug: readSlug(source.slug, `${field}.slug`),
        version: readSemver(source.version, `${field}.version`),
        name: readString(source.name, `${field}.name`),
        summary: readString(source.summary, `${field}.summary`),
        ...(description ? { description } : {}),
        ...(tags ? { tags } : {}),
        source: readSource(source.source, `${field}.source`),
        compatibility: readCompatibility(source.compatibility, `${field}.compatibility`),
        license: readLicense(source.license, `${field}.license`),
    };
}

function readSourcePackage(value: unknown, field: string): SourceIntakePackage {
    const base = readBasePackage(value, field);
    const source = readObject(value, field);
    const files = readArray(source.files, `${field}.files`).map((entry, index) =>
        readFileMapping(entry, `${field}.files[${String(index)}]`)
    );
    if (files.length === 0) {
        throw new Error(`Invalid "${field}.files": expected at least one selected file.`);
    }
    if (base.kind === 'skill') {
        const skill = readObject(source.skill, `${field}.skill`);
        assertAllowedKeys(skill, new Set(['entryFile']), `${field}.skill`);
        return {
            ...base,
            kind: 'skill',
            files,
            skill: { entryFile: readRelativePath(skill.entryFile, `${field}.skill.entryFile`) },
        };
    }
    if (base.kind === 'mode') {
        const mode = readObject(source.mode, `${field}.mode`);
        assertAllowedKeys(mode, new Set(['manifestFile']), `${field}.mode`);
        return {
            ...base,
            kind: 'mode',
            files,
            mode: { manifestFile: readRelativePath(mode.manifestFile, `${field}.mode.manifestFile`) },
        };
    }
    const mcp = readObject(source.mcp, `${field}.mcp`);
    assertAllowedKeys(mcp, new Set(['manifestFile', 'serverLabel']), `${field}.mcp`);
    return {
        ...base,
        kind: 'mcp',
        files,
        mcp: {
            manifestFile: readRelativePath(mcp.manifestFile, `${field}.mcp.manifestFile`),
            serverLabel: readString(mcp.serverLabel, `${field}.mcp.serverLabel`),
        },
    };
}

export function parseSourceIntakeCatalog(json: unknown): SourceIntakeCatalog {
    const source = readObject(json, 'input');
    assertAllowedKeys(source, new Set(['schemaVersion', 'kind', 'packages']), 'input');
    if (source.schemaVersion !== sourceIntakeCatalogSchemaVersion) {
        throw new Error(`Invalid "schemaVersion": expected ${String(sourceIntakeCatalogSchemaVersion)}.`);
    }
    const kind = readEnum(source.kind, 'kind', packageKinds);
    const packages = readArray(source.packages, 'packages').map((entry, index) =>
        readSourcePackage(entry, `packages[${String(index)}]`)
    );
    const identities = new Set<string>();
    for (const pkg of packages) {
        if (pkg.kind !== kind) {
            throw new Error(`Invalid "packages": package kind "${pkg.kind}" does not match source catalog kind "${kind}".`);
        }
        const identity = `${pkg.kind}:${pkg.slug}:${pkg.version}`;
        if (identities.has(identity)) {
            throw new Error(`Invalid "packages": duplicate source package "${identity}".`);
        }
        identities.add(identity);
    }
    return {
        schemaVersion: sourceIntakeCatalogSchemaVersion,
        kind,
        packages,
    };
}

function kindRoot(kind: PackageKind): string {
    return kind === 'skill' ? 'distribution/skills' : kind === 'mode' ? 'distribution/modes' : 'distribution/mcps';
}

function packageRootRelativePath(pkg: SourceIntakePackage): string {
    return `${kindRoot(pkg.kind)}/${pkg.slug}`;
}

function packageMetadataForSource(input: {
    sourcePackage: SourceIntakePackage;
    resolvedCommitSha: string;
    contentSha256: string;
    sizeBytes: number;
}): MarketplacePackageMetadata {
    const sourcePackage = input.sourcePackage;
    const packageRoot = packageRootRelativePath(sourcePackage);
    const base = {
        kind: sourcePackage.kind,
        slug: sourcePackage.slug,
        version: sourcePackage.version,
        name: sourcePackage.name,
        summary: sourcePackage.summary,
        ...(sourcePackage.description ? { description: sourcePackage.description } : {}),
        ...(sourcePackage.tags ? { tags: sourcePackage.tags } : {}),
        source: {
            repositoryUrl: sourcePackage.source.repositoryUrl,
            commitSha: input.resolvedCommitSha,
            relativePath: sourcePackage.source.relativePath,
        },
        distribution: {
            repositoryUrl: marketplaceRepositoryUrl,
            commitSha: input.resolvedCommitSha,
            relativePath: packageRoot,
            contentSha256: input.contentSha256,
            sizeBytes: input.sizeBytes,
        },
        compatibility: sourcePackage.compatibility,
    };
    if (sourcePackage.kind === 'skill') {
        return {
            ...base,
            kind: 'skill',
            skill: { entryFile: `${packageRoot}/${sourcePackage.skill.entryFile}` },
        };
    }
    if (sourcePackage.kind === 'mode') {
        return {
            ...base,
            kind: 'mode',
            mode: { manifestFile: `${packageRoot}/${sourcePackage.mode.manifestFile}` },
        };
    }
    return {
        ...base,
        kind: 'mcp',
        mcp: {
            manifestFile: `${packageRoot}/${sourcePackage.mcp.manifestFile}`,
            serverLabel: sourcePackage.mcp.serverLabel,
        },
    };
}

function sourceFileMap(files: SourceFileBytes[]): Map<string, Uint8Array> {
    const mapped = new Map<string, Uint8Array>();
    for (const file of files) {
        if (mapped.has(file.packagePath)) {
            throw new Error(`Invalid source files: duplicate package path "${file.packagePath}".`);
        }
        mapped.set(file.packagePath, file.bytes);
    }
    return mapped;
}

function sha256Bytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export async function materializeSourceIntakePackage(input: MaterializeSourcePackageInput): Promise<AuthoredMarketplacePackage> {
    const sourcePackage = input.sourcePackage;
    if (sourcePackage.kind !== input.catalogKind) {
        throw new Error(`Invalid source package "${sourcePackage.slug}": package kind does not match source catalog kind.`);
    }
    if (!commitShaPattern.test(input.resolvedCommitSha)) {
        throw new Error(`Invalid source package "${sourcePackage.slug}": resolved commit SHA is invalid.`);
    }
    const rootRelativePath = packageRootRelativePath(sourcePackage);
    const packageRoot = path.join(input.rootDir, rootRelativePath);
    const files = sourceFileMap(input.files);
    for (const mapping of sourcePackage.files) {
        if (!files.has(mapping.packagePath)) {
            throw new Error(`Invalid source package "${sourcePackage.slug}": missing selected file "${mapping.packagePath}".`);
        }
    }
    if (!files.has(sourcePackage.license.evidenceFile)) {
        throw new Error(`Invalid source package "${sourcePackage.slug}": missing license evidence file.`);
    }

    await rm(packageRoot, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    for (const [relativePath, bytes] of [...files.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
        const outputPath = path.join(packageRoot, relativePath);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes);
    }

    const contentDigest = await hashVendoredPackageDirectory(packageRoot);
    const metadata = packageMetadataForSource({
        sourcePackage,
        resolvedCommitSha: input.resolvedCommitSha,
        contentSha256: contentDigest.sha256,
        sizeBytes: contentDigest.sizeBytes,
    });
    const evidenceSha256 = sha256Bytes(files.get(sourcePackage.license.evidenceFile)!);
    if (!sha256Pattern.test(evidenceSha256)) {
        throw new Error(`Invalid source package "${sourcePackage.slug}": license evidence hash is invalid.`);
    }
    const authored = {
        schemaVersion: marketplaceCatalogSchemaVersion,
        metadata,
        compliance: {
            license: {
                spdxExpression: sourcePackage.license.spdxExpression,
                evidencePath: `${rootRelativePath}/${sourcePackage.license.evidenceFile}`,
                evidenceSha256,
                reviewStatus: sourcePackage.license.reviewStatus,
                ...(sourcePackage.license.notices ? { notices: sourcePackage.license.notices } : {}),
            },
        },
    };
    const metadataPath = path.join(packageRoot, 'marketplace.v1.json');
    await writeFile(metadataPath, `${JSON.stringify(authored, null, 4)}\n`, 'utf8');
    return {
        ...authored,
        filePath: metadataPath,
        packageRoot,
    };
}

export async function readSourceIntakeCatalogFile(filePath: string): Promise<SourceIntakeCatalog> {
    return parseSourceIntakeCatalog(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
}

export async function validateSourceIntakeCatalogs(rootDir: string): Promise<SourceIntakeCatalog[]> {
    const sourceFiles = [
        { kind: 'skill' as const, path: path.join(rootDir, 'sources', 'skills.v1.json') },
        { kind: 'mcp' as const, path: path.join(rootDir, 'sources', 'mcps.v1.json') },
        { kind: 'mode' as const, path: path.join(rootDir, 'sources', 'modes.v1.json') },
    ];
    const catalogs: SourceIntakeCatalog[] = [];
    const identities = new Set<string>();
    for (const sourceFile of sourceFiles) {
        const catalog = await readSourceIntakeCatalogFile(sourceFile.path);
        if (catalog.kind !== sourceFile.kind) {
            throw new Error(`Invalid source catalog "${sourceFile.path}": kind must be "${sourceFile.kind}".`);
        }
        for (const pkg of catalog.packages) {
            const identity = `${pkg.kind}:${pkg.slug}:${pkg.version}`;
            if (identities.has(identity)) {
                throw new Error(`Invalid source catalogs: duplicate source package "${identity}".`);
            }
            identities.add(identity);
        }
        catalogs.push(catalog);
    }
    return catalogs;
}
