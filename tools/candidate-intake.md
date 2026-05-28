# Candidate Intake

Candidate discovery can use GitHub stars, GitHub search, curated lists, and directories such as `skills.sh`.
Discovery sources are not install sources.
Marketplace packages install from vendored files in MarketPlace-NC.

The preferred intake path is a source entry in `sources/*.v1.json`.
The source entry declares selected upstream files, package identity, compatibility, and license evidence.
The source sync tool fetches only those selected raw files from a resolved upstream commit.
It then writes vendored package files and `marketplace.v1.json`.

Manual uploads remain allowed for user-authored packages or cases where no upstream repository exists.
Manual uploads still need the same license, provenance, hash, and package-shape validation.

No candidate is accepted just because it is popular.
A candidate must have a clear source path, selected files, reproducible hashes, reviewable size, and license evidence.
Permissive licenses can pass when evidence hashes match.
Restricted or unclear licenses block publication.
Unlicensed repositories can pass only with explicit `UNLICENSED` metadata, pinned commit evidence, and human review.

Mode packages must validate as NeonConductor portable mode JSON v2.
Mode packages remain draft-only when imported into NeonConductor.
Real mode publication still needs explicit approval.

The upstream monitor reads source-pulled skill and MCP entries when the legacy monitor config is empty.
It creates review pull requests only.
It does not update mode packages.
It does not auto-merge or bypass validation.
