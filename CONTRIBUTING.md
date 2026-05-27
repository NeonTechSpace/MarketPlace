# Contributing

This repository publishes NeonConductor marketplace entries after review. During
Phase 18A, contribution work is limited to package layout, metadata, validation,
and tooling.

## Branch Names

- Package entries: `add-package/<kind>/<slug>-<version>`
- Tooling: `tool/<name>`

Examples:

- `add-package/skill/repo-review-1.0.0`
- `add-package/mode/focused-implementer-1.0.0`
- `tool/catalog-validator`

## PR Titles

Use one of:

- `type: short lowercase subject`
- `type(scope): short lowercase subject`

Allowed types:

`build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `test`

Useful marketplace scopes:

`marketplace`, `package-skill`, `package-mode`, `package-mcp`, `licensing`, `provenance`, `tools`

## Package Submission Rules

Every package must include:

- source repository URL
- pinned source commit
- source-relative path
- package version
- SPDX license expression
- license evidence path
- license evidence SHA-256
- generated artifact SHA-256
- review status
- required notices

A commit hash proves provenance, not permission. If the pinned commit has no
license, the package cannot be published. Ask upstream for a licensed commit,
record explicit written permission, or reimplement the idea without copying
protected content.

Permissive SPDX/OSI licenses such as `MIT`, `Apache-2.0`, `BSD-2-Clause`,
`BSD-3-Clause`, `ISC`, and `0BSD` can pass automatically when evidence matches.
Other licenses require maintainer review before publication.

## Validation

Run:

```powershell
pnpm run check
```

Do not add publishing behavior, GitHub Releases, GitHub Packages, Deployments,
Environments, or GitHub Pages in Phase 18A.

## AI Assistance Disclosure

If AI was used, disclose where it was used:

- research
- planning
- code or metadata edits
- validation/debugging

Do not submit unreviewed AI output. The contributor is responsible for the final
content, package metadata, license evidence, and validation results.
