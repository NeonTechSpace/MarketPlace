# Contributing To MarketPlace-NC

MarketPlace-NC prefers source records over hand-copied package files.
Vendored files are generated or validated output.
Keep pull requests small enough to review by inspection.

## PR Basics

Use scoped branches:

- `add-package/<kind>/<slug>-<version>`
- `tool/<short-purpose>`
- `docs/<short-purpose>`

Use semantic PR titles:

- `feat(skill): add repo review package`
- `chore(marketplace): refresh upstream package pins`
- `docs(modes): explain portable mode shape`

## Add A Package

Start with the matching source file:

- skills: `sources/skills.v1.json`
- MCPs: `sources/mcps.v1.json`
- modes: `sources/modes.v1.json`

A source entry must include:

- kind, slug, version, name, and summary
- upstream repository and source path
- upstream commit SHA
- selected files
- entry file or manifest file
- Neon compatibility range
- license evidence

Run:

```powershell
pnpm run source:sync
pnpm run check
```

## Manual Packages

Manual vendoring is allowed when a package is user-authored or has no useful upstream repo.
Manual packages still need `marketplace.v1.json`.
Manual packages still need license evidence, deterministic hashes, and normal validation.

## File Rules

Package roots:

- `distribution/skills/<slug>/`
- `distribution/mcps/<slug>/`
- `distribution/modes/<slug>/`

Names:

- package slugs use lowercase kebab-case
- package metadata is `marketplace.v1.json`
- skill entry files are usually `SKILL.md`
- MCP manifests are usually `server.json`
- mode manifests are usually `mode.json`

Generated catalogs are CI output.
Local `generated/` files are ignored.
Do not hand-author `distribution.files`.
Keep `.gitkeep` files in empty distribution family folders.

## Size Rules

Use selected files only.
Do not copy whole repositories.
Do not vendor generated dependency trees.
Do not vendor binaries unless explicitly approved.
Narrow packages that are hard to review by file count or byte size.

## License Rules

Accepted code-license baseline:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- 0BSD

CC0-1.0 may be accepted for non-code material.
Restricted, unclear, or mismatched license evidence blocks publication.

Unlicensed upstream packages require:

- `spdxExpression: "UNLICENSED"`
- `reviewStatus: "approved_unlicensed"`
- a pinned upstream commit
- evidence explaining that no license file was present at that commit

## Mode Rules

Mode packages must use NeonConductor portable mode JSON v2.
The authoring role must match the role template.
Marketplace mode imports become NeonConductor drafts.
Marketplace mode imports do not activate modes.

Use `chat` for normal conversation modes.
Use `single_task_agent` for user-selected agent modes.
Use `orchestrator_primary` for the user-facing orchestrator role.
Use `orchestrator_worker_agent` only for delegated orchestration workers.

An `orchestrator_primary` mode is something the operator can review as an Orchestrator-surface mode.
An `orchestrator_worker_agent` mode is a worker shape the orchestrator can delegate to.
Worker modes should not be described as normal top-level modes.

Keep real mode packages out of production directories until explicitly approved.

## Update Monitor

The upstream monitor is PR-only.
It applies to configured source-pulled skill and MCP packages.
Future monitor configuration may track moving upstream refs, but package source records must stay pinned to commit SHAs.
It does not update mode packages.
It does not auto-merge.
It does not publish directly.
It does not bypass validation.

## AI Assistance

AI assistance is allowed.
The contributor remains responsible for source selection, license evidence, provenance, validation, and review accuracy.
