# NeonConductor MarketPlace-NC

MarketPlace-NC is the public package catalog for NeonConductor.
It is validation-first.
It does not use GitHub Releases or GitHub Packages.
GitHub Pages hosts generated catalog JSON.

## Quick Model

- Write small source records in `sources/*.v1.json`.
- Sync selected upstream raw files into `skills/`, `mcps/`, or `modes/`.
- Validate vendored files, license evidence, hashes, and package shape.
- Generate catalogs in CI.
- Publish only `catalog/v1/*.json` through GitHub Pages.

NeonConductor installs from MarketPlace-NC.
Upstream repos are provenance and update inputs.

## Source Records

Use these files as the normal package request surface:

- `sources/skills.v1.json`
- `sources/mcps.v1.json`
- `sources/modes.v1.json`

Each source record says:

- package kind, slug, version, name, and summary
- upstream repository, commit SHA, and source path
- selected upstream files to copy
- entry file or manifest file
- Neon compatibility range
- license evidence and review status

Use `pnpm run source:sync` to materialize source records.
Use `pnpm run source:check` to validate source records without writing files.

## Vendored Packages

Vendored package files live here:

- `skills/<slug>/`
- `mcps/<slug>/`
- `modes/<slug>/`

Each package directory contains `marketplace.v1.json`.
For source-pulled packages, that file is generated metadata.
For manual packages, that file is validated metadata.

Normal file names:

- skills: `SKILL.md`
- MCPs: `server.json`
- modes: `mode.json`

Keep packages small and inspectable.
Do not copy whole repositories.
Do not vendor dependency trees, binaries, or unrelated examples unless there is an approved reason.

## Catalogs

Catalogs are generated output.
They are not tracked source truth.
Local generation writes ignored files under `generated/`.
CI prepares Pages output under `.marketplace-pages/`.

Published catalog paths:

- `catalog/v1/catalog.json`
- `catalog/v1/skills.json`
- `catalog/v1/mcps.json`
- `catalog/v1/modes.json`

Family catalogs let NeonConductor load only one package type.
The full catalog is for browsing, audits, and tooling.

## Install Safety

`source.commitSha` is the required upstream commit that was reviewed or fetched.
`distribution.commitSha` is the MarketPlace-NC commit NeonConductor installs from.

Catalog entries include `distribution.files`.
Each file entry records package-relative path, SHA-256, and byte size.
NeonConductor fetches only those listed files.
NeonConductor verifies every listed file before install.

## Modes

Mode manifests must be NeonConductor portable mode JSON v2.
Mode packages import into NeonConductor as drafts.
They do not activate modes directly.

Supported authoring roles:

- `chat`
- `single_task_agent`
- `orchestrator_primary`
- `orchestrator_worker_agent`

Role meanings:

- `chat` is for normal conversation modes.
- `single_task_agent` is for user-selected agent modes such as ask, plan, apply, debug, research, and review.
- `orchestrator_primary` is the user-facing orchestrator role that plans, coordinates, delegates, debugs, or synthesizes work.
- `orchestrator_worker_agent` is a delegated worker role used by orchestration and should not be presented as a normal selectable top-level mode.

The role template must match the authoring role.
The validator rejects portable mode v1, unknown fields, bad role/template pairs, and malformed prompt overrides.

## License Policy

Accepted code-license baseline:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- 0BSD

CC0-1.0 may be accepted for non-code material.
Restricted or unclear licenses are blocked.

Unlicensed upstream packages can be accepted only with:

- `spdxExpression: "UNLICENSED"`
- `reviewStatus: "approved_unlicensed"`
- pinned upstream commit evidence
- a checked evidence file explaining no license file was present at that commit

## Commands

Install dependencies:

```powershell
pnpm install --frozen-lockfile
```

Run the full validation:

```powershell
pnpm run check
```

Sync source records:

```powershell
pnpm run source:sync
```

Generate local catalogs:

```powershell
pnpm run generate
```

Prepare Pages output:

```powershell
pnpm run pages
```
