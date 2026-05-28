# NeonConductor MarketPlace-NC

MarketPlace-NC is the public catalog and package source for NeonConductor marketplace entries.
It is validation-first and does not publish GitHub Releases or GitHub Packages.
GitHub Pages hosts generated catalog JSON only.

## How It Works

The preferred authoring surface is `sources/*.v1.json`.
Those files are small review records that say where a package comes from, which upstream files are selected, what license evidence was reviewed, and which NeonConductor versions the package targets.
The source sync tool can fetch only those selected raw files from the resolved upstream commit.
The synced files are vendored into `skills/<slug>/`, `mcps/<slug>/`, or `modes/<slug>/`.
Each vendored package directory owns a `marketplace.v1.json` file.
That file is generated or validated package metadata, not the main thing people should hand-write for source-pulled packages.

Generated catalogs live in `generated/`.
Pages output lives under `catalog/v1/` when the Pages workflow runs.
The full catalog is `catalog/v1/catalog.json`.
Family catalogs are `catalog/v1/skills.json`, `catalog/v1/mcps.json`, and `catalog/v1/modes.json`.
Family catalogs exist so NeonConductor can load only the package family it needs.
The full catalog exists for browsing, audits, and tooling that wants all package families at once.

## Source And Distribution

`source.commitSha` is upstream provenance.
It records the upstream commit that was reviewed or fetched.
`distribution.commitSha` is the Marketplace-NC commit NeonConductor installs from.
NeonConductor installs from Marketplace-NC, not from upstream repositories.
The upstream repository remains evidence and update input.

Catalog entries include `distribution.files`.
Each file entry has a package-relative path, SHA-256, and byte size.
NeonConductor fetches only the selected package files from the pinned Marketplace-NC commit.
It verifies every file hash and size, then recomputes the aggregate package hash before trusting the install.

## Folders

`sources/` contains compact package-intake files.
`skills/`, `mcps/`, and `modes/` contain vendored package files.
`generated/` contains checked generated catalog fixtures for validation.
`tools/` contains validation, source sync, catalog generation, Pages preparation, upstream monitoring, and tests.
`.github/` contains validation-only workflows and repository metadata.

Package directories should be named with lowercase kebab-case slugs.
Package metadata files are always named `marketplace.v1.json`.
Skill entry files are usually named `SKILL.md`.
MCP manifest files are usually named `server.json`.
Mode manifest files are usually named `mode.json`.

Keep packages small enough that a user can understand what is being installed.
Use selected-file package entries instead of copying whole repositories.
If a candidate needs many large files, split it or leave it out until there is a stronger product reason.
Every generated catalog records byte sizes so reviewers can see package weight before install.

## Modes

Mode packages are supported by the schema and validator.
Real mode publication still needs explicit approval.
Marketplace mode manifests must be NeonConductor portable mode JSON v2.
Valid mode authoring roles are `chat`, `single_task_agent`, `orchestrator_primary`, and `orchestrator_worker_agent`.
Valid role templates are the role templates NeonConductor currently supports for those roles.
The validator rejects mode manifests that use unknown fields, invalid role/template pairs, portable mode v1, or malformed prompt-layer overrides.

## License Policy

Permissive SPDX licenses are accepted when the evidence file hash matches the reviewed source.
Restricted or unclear licenses are blocked.
Unlicensed upstream packages may be accepted only with explicit `UNLICENSED` metadata, an `approved_unlicensed` review status, a pinned upstream commit, and checked evidence explaining that no license file was present at that commit.
That status remains visible so NeonConductor can present the package honestly.

## Commands

Install dependencies:

```powershell
pnpm install --frozen-lockfile
```

Validate everything:

```powershell
pnpm run check
```

Sync source entries into vendored package files:

```powershell
pnpm run source:sync
```

Check source entries without writing vendored files:

```powershell
pnpm run source:check
```

Regenerate catalogs:

```powershell
pnpm run generate
```

Prepare Pages catalog output:

```powershell
pnpm run pages
```

Check upstream package updates:

```powershell
pnpm run upstream:check
```
