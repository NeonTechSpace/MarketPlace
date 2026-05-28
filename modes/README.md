# Mode Packages

Mode package publication is supported by the validator but still requires explicit approval.
Production mode package directories should stay empty until a real mode is approved.

Marketplace mode manifests must be NeonConductor portable mode JSON v2.
The manifest file is usually named `mode.json`.
The source entry points to that file through `mode.manifestFile`.

Supported authoring roles are `chat`, `single_task_agent`, `orchestrator_primary`, and `orchestrator_worker_agent`.
`chat` means a normal conversation mode.
`single_task_agent` means a user-selected agent mode.
`orchestrator_primary` means the user-facing orchestrator role.
`orchestrator_worker_agent` means a delegated worker role used by orchestration.

An `orchestrator_primary` mode can plan, coordinate, delegate, debug orchestration, or synthesize work.
An `orchestrator_worker_agent` mode performs a bounded worker job delegated by an orchestrator.
Worker modes are delegated-only and should not be described as normal selectable top-level modes.

Supported chat role templates:

- `chat/default`

Supported agent role templates:

- `single_task_agent/ask`
- `single_task_agent/plan`
- `single_task_agent/apply`
- `single_task_agent/debug`
- `single_task_agent/research`
- `single_task_agent/review`

Supported orchestrator primary role templates:

- `orchestrator_primary/plan`
- `orchestrator_primary/orchestrate`
- `orchestrator_primary/debug`

Supported orchestrator worker role templates:

- `orchestrator_worker_agent/apply`
- `orchestrator_worker_agent/debug`
- `orchestrator_worker_agent/explorer`

Marketplace validation rejects portable mode v1, unknown fields, invalid role/template pairs, and malformed prompt-layer overrides.
NeonConductor imports marketplace modes as review drafts only.
Mode import does not activate a mode or write a live mode file.
