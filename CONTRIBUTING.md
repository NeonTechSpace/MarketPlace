# Contributing

This repository publishes NeonConductor marketplace entries after review.

## Branch Names

- Package entries: `add-package/<kind>/<slug>-<version>`
- Tooling: `tool/<name>`

Examples:

- `add-package/skill/repo-review-1.0.0`
- `add-package/mcp/github-1.0.0`
- `tool/catalog-validator`

Do not create `dev` or `prev` unless a phase explicitly needs those branches.

## PR Titles

Use one of:

- `type: short lowercase subject`
- `type(scope): short lowercase subject`

Allowed types:

`build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `test`

Useful marketplace scopes:

`marketplace`, `package-skill`, `package-mcp`, `licensing`, `provenance`, `tools`

## Package Submission Rules

Every package must include:

- vendored package files in this repository
- source repository URL
- pinned upstream source commit
- upstream source-relative path
- marketplace package path
- marketplace package version
- vendored package content SHA-256
- vendored package byte size
- generated file manifest in the published catalog
- SPDX license expression
- license evidence path
- license evidence SHA-256
- review status
- required notices

Do not hand-author `distribution.files` in `marketplace.v1.json`.
The generator adds the per-file manifest to published catalogs from the vendored package contents so NeonConductor can fetch only selected commit-pinned raw files and verify each file before install.

A commit hash proves provenance, not permission.
If the pinned commit has no license, the package cannot be published.
Ask upstream for a licensed commit, record explicit written permission, or reimplement the idea without copying protected content.

Permissive SPDX/OSI licenses such as `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, and `0BSD` can pass automatically when evidence matches.
Other licenses require maintainer review before publication.

## Skills And MCPs

Skills and MCPs are eligible for package submissions during Phase 18B when their vendored files and license evidence validate.

`skills.sh`, GitHub starred repositories, and GitHub search may be used as candidate discovery sources.
They are not trust authorities.
A package is accepted only after source, license, path, and hash validation passes.

## Modes

Mode packages are deferred until NeonConductor first alpha is finished.

A future marketplace-ready mode should include:

- clear operator purpose
- prompt and behavior boundaries
- expected model and tool capabilities
- activation assumptions
- safety and permission posture
- compatibility range
- examples and validation expectations

## Validation

Run:

```powershell
pnpm run check
```

Do not add GitHub Releases or GitHub Packages for package artifacts in Phase 18B.
GitHub Pages is used for generated catalog publication.

## Upstream Updates

Approved package updates are PR-only.
The update monitor reads `tools/upstream-monitor.v1.json`, checks configured upstream refs, and re-vendors only configured raw files from a resolved commit.
It must not download full repository archives.
It must not update unconfigured package paths.
It must not update modes before NeonConductor first alpha is finished.

Update PRs must include the old and new upstream commits, changed files, license evidence status, and any risk flags.
The generated PR still needs normal package, license, provenance, and catalog validation.
Human review is required before any update reaches `main`.

## AI Assistance Disclosure

If AI was used, disclose where it was used:

- research
- planning
- code or metadata edits
- validation/debugging

Do not submit unreviewed AI output.
The contributor is responsible for the final content, package metadata, license evidence, and validation results.
