# Mode Packages

This folder holds marketplace mode packages.
It is empty until a real mode package is approved.

Mode packages are imported into NeonConductor as drafts.
They do not activate a mode by themselves.

## Required Shape

Mode manifests use NeonConductor portable mode JSON v2.
The usual file name is `mode.json`.
The source entry points to it with `mode.manifestFile`.

Required manifest fields:

- `version: 2`
- `slug`
- `name`
- `authoringRole`
- `roleTemplate`

## Authoring Roles

Use `chat` for normal conversation modes.
Use `single_task_agent` for user-selected agent modes.
Use `orchestrator_primary` for the user-facing orchestrator role.
Use `orchestrator_worker_agent` for delegated workers used by orchestration.

An `orchestrator_primary` mode can plan, coordinate, delegate, debug orchestration, or synthesize work.
An `orchestrator_worker_agent` mode performs a bounded worker job delegated by an orchestrator.
Worker modes are delegated-only.
Do not describe worker modes as normal selectable top-level modes.

## Role Templates

Chat:

- `chat/default`

Agent:

- `single_task_agent/ask`
- `single_task_agent/plan`
- `single_task_agent/apply`
- `single_task_agent/debug`
- `single_task_agent/research`
- `single_task_agent/review`

Orchestrator primary:

- `orchestrator_primary/plan`
- `orchestrator_primary/orchestrate`
- `orchestrator_primary/debug`

Orchestrator worker:

- `orchestrator_worker_agent/apply`
- `orchestrator_worker_agent/debug`
- `orchestrator_worker_agent/explorer`

## Validation

Marketplace validation rejects portable mode v1.
Marketplace validation rejects unknown fields.
Marketplace validation rejects bad role/template pairs.
Marketplace validation rejects malformed prompt-layer overrides.
