# NeonConductor MarketPlace

Canonical source repository for NeonConductor marketplace entries.

This repository is in Phase 18B.
Approved skill and MCP package files are vendored into this repository, and generated catalogs are prepared for GitHub Pages.
Upstream repository URL, pinned commit, source path, content hash, file manifest, and license evidence are audit records.
NeonConductor installs from the vendored marketplace copy, not from arbitrary upstream repositories.

## Package Families

- `skills/<slug>/SKILL.md`
- `mcps/<slug>/<manifest>`
- `modes/` remains schema-supported but empty until NeonConductor first alpha is finished

Each package directory owns a `marketplace.v1.json` file with the package metadata consumed by NeonConductor plus marketplace-only license and provenance evidence used by this repository's validation tooling.

## Validation

Use Node 24.14.1 and pnpm 11.1.2.

```powershell
pnpm install
pnpm run check
```

The check command runs type checking, tests, metadata validation, generated catalog freshness checks, deterministic vendored-content checks, and Pages catalog output checks.

## Generated Catalogs

Tracked generated catalogs live under `generated/`.

Pages publication prepares:

- `catalog/v1/catalog.json`
- `catalog/v1/skills.json`
- `catalog/v1/mcps.json`
- `catalog/v1/modes.json`

The mode catalog is intentionally valid and empty during Phase 18B.

Generated package records include `distribution.files`, a deterministic per-package manifest of installable files with package-relative path, SHA-256, and byte size.
The manifest lets NeonConductor fetch only the selected package's commit-pinned raw files, verify each file, and then recompute the aggregate package hash before install.
Authors do not maintain this list by hand.

## Publication Status

Phase 18B enables GitHub Pages catalog publication.
GitHub Releases and GitHub Packages are not used for package artifacts in this slice.
Package installation should verify the catalog commit, package path, per-file manifest entries, vendored content SHA-256, and size before trusting local package files.

## Upstream Update Monitoring

Phase 18G adds PR-only upstream update monitoring for vendored skill and MCP packages.
The monitor reads `tools/upstream-monitor.v1.json`, resolves configured upstream refs, compares them to pinned source commits, and fetches only configured raw files from the resolved commit.
It does not download repository archives.
It does not update packages that are not listed in the monitor config.
It does not update mode packages.

Run a dry check with:

```powershell
pnpm run upstream:check
```

Run a local update with:

```powershell
pnpm run upstream:update
```

The scheduled GitHub workflow creates a pull request when package files, hashes, license evidence, or generated catalogs change.
It does not auto-merge, publish directly, create Releases, create Packages, or bypass normal validation.
