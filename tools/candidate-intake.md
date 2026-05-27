# Phase 18B Candidate Intake

Candidate sources used for Phase 18B:

- GitHub starred repositories
- GitHub repository search for MCP and skill packages
- `skills.sh` as discovery only

Seed packages accepted in this slice:

| Kind | Slug | Upstream | Commit | License | Reason |
| --- | --- | --- | --- | --- | --- |
| skill | `enhance-prompt` | `google-labs-code/stitch-skills` | `53f15d81da854039aae10e8af19ad389c3997653` | Apache-2.0 | Small, directly vendorable skill with clear `SKILL.md` entry and license evidence. |
| skill | `taste-design` | `google-labs-code/stitch-skills` | `53f15d81da854039aae10e8af19ad389c3997653` | Apache-2.0 | Small, directly vendorable design-review skill with clear `SKILL.md` entry and license evidence. |
| mcp | `github` | `github/github-mcp-server` | `f80ca8555bd5cd89e4b0850505fb6f392413b5a2` | MIT | Official GitHub MCP manifest with clear source, license evidence, and stable manifest file. |

Candidates deferred or blocked:

- `vercel-labs/agent-skills`: GitHub API did not report a license at discovery time.
- `openai/skills`: GitHub API did not report a license at discovery time.
- Curated-list repositories such as awesome lists: discovery sources only, not installable package entries.
- Mode packages: deferred until NeonConductor first alpha is finished.

Future update pipeline:

- Check upstream configured refs on a schedule or manual dispatch.
- Create PRs only.
- Re-vendor changed files, recompute content hashes, rerun license checks, and include risk flags.
- Block updates when license evidence disappears, source paths move unexpectedly, package shape changes, or hashes cannot be reproduced.
