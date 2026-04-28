# ADR-001: Monorepo Structure with pnpm + Turborepo

**Date**: 2024-01-01  
**Status**: Accepted  
**Deciders**: VGC Engineering Team

## Context

VGC ITSM consists of multiple applications (web, API, functions, teams-app) and shared packages (graph-client, ai-prompts, ui). We need a strategy for managing these as a coherent codebase.

## Decision

Use a pnpm workspace monorepo with Turborepo for task orchestration.

## Rationale

1. **pnpm**: Efficient disk usage via content-addressable store. Strict peer dependency resolution prevents phantom dependencies.
2. **Turborepo**: Incremental builds via task graph. Only rebuild packages that changed. Remote cache in CI.
3. **Single repo**: Atomic commits across packages. Eliminates version skew between internal packages. Shared CI/CD.

## Consequences

- All packages versioned together (`0.0.1` until v1 release).
- `pnpm-workspace.yaml` defines workspace roots.
- `turbo.json` defines task dependencies (e.g., `build` depends on `^build` of dependencies).
- Dependabot configured for `semver:minor` auto-merge on all packages.

## Alternatives Considered

- **nx**: More complex setup, heavier tooling.
- **yarn workspaces**: Less strict than pnpm, phantom dependency risk.
- **Separate repos**: Version skew, coordination overhead.
