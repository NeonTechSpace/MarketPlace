# Marketplace Review Rules

## Source Of Truth

MarketPlace-NC is the curated install source for NeonConductor marketplace packages.
Upstream repositories are provenance only.
Do not introduce behavior that installs from upstream repository URLs, branch heads, or live main.

## License And Provenance

Every package must keep clear source, pinned commit, source path, vendored path, SPDX license, license evidence hash, review status, and notices.
No-license, unclear-license, restricted-license, and manual-review packages must not become publication-ready.

## File Manifest Safety

Generated catalogs should include deterministic `distribution.files` entries so NeonConductor can fetch only the selected package files.
Each file entry must be package-relative and include SHA-256 plus byte size.
Never allow absolute paths, parent traversal, backslashes, generated metadata files, or hand-authored file manifests.

## Publication Boundaries

GitHub Pages publishes catalogs only.
GitHub Releases, GitHub Packages, real mode packages, trusted-author automation, and automatic upstream update PRs remain outside this slice.
