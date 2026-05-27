# NeonConductor MarketPlace

Canonical source repository for NeonConductor marketplace entries.

This repository is in Phase 18A bootstrap. It validates package metadata, package
shape, license evidence, provenance, generated catalogs, and deterministic local
package artifacts. It does not publish packages yet.

## Package Families

- `skills/<slug>/SKILL.md`
- `modes/<slug>/MODE.yaml`
- `mcps/<slug>/MCP.yaml`

Each package directory owns a `marketplace.v1.json` file with the package
metadata consumed by NeonConductor plus marketplace-only license and provenance
evidence used by this repository's validation tooling.

Production package directories are intentionally empty until real first-party
packages are approved.

## Validation

Use Node 24.14.1 and pnpm 11.1.2.

```powershell
pnpm install
pnpm run check
```

The check command runs type checking, tests, metadata validation, generated
catalog freshness checks, and deterministic package artifact checks.

## Publication Status

Phase 18A is validation-only.

- No GitHub Releases
- No GitHub Packages
- No GitHub Pages publication
- No Deployments or Environments

Phase 18B will add public catalog and immutable artifact publication after the
layout and validation contracts are stable.
