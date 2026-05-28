# Contributing To MarketPlace-NC

MarketPlace-NC accepts package intake through small source records first.
Vendored files are generated or validated output.
This keeps pull requests readable and prevents whole repositories from becoming install sources.

## Branches And Titles

Use short, scoped branch names.
Package submissions should use `add-package/<kind>/<slug>-<version>`.
Tooling changes should use `tool/<short-purpose>`.
Documentation changes should use `docs/<short-purpose>`.

Pull request titles should use the repository label style.
Examples are `feat(skill): add repo review package`, `chore(marketplace): refresh upstream package pins`, and `docs(modes): explain portable mode shape`.

## Package Intake

Add source-pulled packages to the matching source file under `sources/`.
Use `sources/skills.v1.json` for skills.
Use `sources/mcps.v1.json` for MCP packages.
Use `sources/modes.v1.json` for mode packages.

Each source entry must declare the package kind, slug, version, name, summary, source repository, source path, selected files, entry or manifest file, compatibility range, and license evidence.
Source-pulled packages should use selected raw files only.
Do not point NeonConductor at upstream repositories as install sources.
Do not add whole-repository archives.

Manual vendored uploads are allowed when there is no useful upstream repository or when the package is user-authored.
Manual uploads still need `marketplace.v1.json`, license review metadata, deterministic hashes, and normal validation.

## File And Folder Rules

Package roots are `skills/<slug>/`, `mcps/<slug>/`, and `modes/<slug>/`.
Package slugs use lowercase kebab-case.
Package metadata is named `marketplace.v1.json`.
Generated catalogs are kept under `generated/`.
Source entries are kept under `sources/`.

Do not hand-author `distribution.files` in `marketplace.v1.json`.
The generator adds the per-file manifest to published catalogs from the vendored package contents.
That manifest lets NeonConductor fetch only selected commit-pinned raw files and verify each file before install.

Keep package files focused and inspectable.
Avoid vendoring generated dependency trees, binaries, screenshots, large examples, and unrelated upstream repository content.
If file size or file count makes review hard, the package should be narrowed before it is accepted.

## License Evidence

Permissive SPDX licenses need a license evidence file and a matching SHA-256.
The accepted code-license baseline is MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, and 0BSD.
CC0-1.0 may be accepted for non-code material.
Restricted, unclear, or mismatched license evidence blocks publication.

Unlicensed upstream packages are allowed only with explicit `UNLICENSED` metadata.
The review status must be `approved_unlicensed`.
The source entry and package metadata must record the pinned upstream commit that was checked.
The evidence file should explain where license discovery looked and that no license file was present at that commit.

## Modes

Mode packages must use NeonConductor portable mode JSON v2.
Valid authoring roles are `chat`, `single_task_agent`, `orchestrator_primary`, and `orchestrator_worker_agent`.
The role template must match the selected authoring role.
Mode packages enter NeonConductor as drafts for review.
They do not directly activate modes.

Real mode publication still needs explicit approval.
Until then, mode fixtures should stay in tests and not in production package directories.

## Validation

Run the full check before opening a pull request:

```powershell
pnpm run check
```

Use source sync when changing source entries:

```powershell
pnpm run source:sync
pnpm run generate
```

Use upstream monitoring only for configured source-pulled skill and MCP packages.
The monitor creates pull requests for review.
It does not auto-merge, publish directly, update mode packages, or bypass validation.

## AI Assistance

AI assistance is allowed.
The contributor remains responsible for source selection, license evidence, provenance, validation, and review accuracy.
