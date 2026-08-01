# Worklog

## Current status

- Current phase: npm distribution and release automation
- Current task: Authenticate the first npm publish and identify the GitHub repository for trusted-publisher setup
- Overall status: Release plumbing is validated locally; remote publication is blocked by missing npm authentication and repository metadata

## Completed

- Read the repository instructions and the full PRD.
- Reviewed the public Z.AI Vision MCP documentation and the independent MIT-licensed `vision-mcp` reference for tool names, image handling, zoom, and video behavior.
- Implemented the strict TypeScript CLI, shared core, generic OpenAI-compatible provider, `opencode-go` profile, security boundary, MCP adapter, skill, installer, docs, and validation scripts.
- Added rerunnable `sidesight setup` with secure `~/.sidesight/config.json` persistence for base URL, model, and API key; saved keys are redacted from `config show`.
- Kept `SIDESIGHT_ALLOWED_DIRS` optional: current working directory is the default, and extra directories can be explicitly added when needed.
- Added deterministic image, video, security, provider, CLI, MCP, acceptance, skill, and clean-package tests.
- Added public npm publish metadata, version-aware package smoke checks, the tag-triggered OIDC publish workflow, and release instructions.

## Validation

- Command: `pnpm install --frozen-lockfile`
  - Result: Passed.
- Command: `pnpm typecheck`
  - Result: Passed with no TypeScript errors.
- Command: `pnpm test`
  - Result: 17 unit tests passed, including setup persistence and config path behavior.
- Command: `pnpm lint` and `pnpm format:check`
  - Result: Passed.
- Command: `pnpm build`
  - Result: Passed; generated production dist excludes test files.
- Command: `pnpm test:integration`
  - Result: 3 mocked integration tests passed; CLI provider requests and the compiled `sidesight mcp` path with actual MCP stdio tool execution verified.
- Command: `pnpm test:acceptance`
  - Result: Passed CLI help, mocked diagnose, JSON output, and safe config display scenarios.
- Command: `pnpm test:pack`
  - Result: Passed clean temporary install, help/version, and mocked provider command smoke checks.
- Command: `npm pack --dry-run --json`
  - Result: Passed; tarball contains the built CLI/MCP binaries, skill, installer, README, release instructions, and license.
- Command: `npm publish --dry-run --access public`
  - Result: Passed without npm metadata normalization warnings.
- Command: `npm publish --access public`
  - Result: Blocked; the current npm session is unauthenticated (`npm whoami` returned 401 and the publish returned registry PUT 404). The package remains unpublished.
- Command: tag/version release check
  - Result: Passed for `v0.1.0`.
- Command: `pnpm test:live`
  - Result: Explicitly skipped because live-provider opt-in and credentials were not supplied.

## Files changed

- `src/` shared core, provider, CLI, doctor, and MCP implementation.
- `skills/`, `.agents/`, and skill installer.
- `scripts/` build, lint, format, acceptance, live, and packaging checks.
- `README.md`, `TASKS.md`, `ACCEPTANCE.md`, `WORKLOG.md`, and package metadata.

## Decisions

- Use a single strict TypeScript package with explicit `core`, `providers`, `config`, `cli`, and `mcp` boundaries. This keeps the executable easy to install while preserving the PRD’s shared-engine architecture.
- Use the canonical `SIDESIGHT_*` environment variables. The reference project’s `VISION_*` names are not copied into the public contract.
- Use bounded overview plus full-resolution crops for detail inspection; model-provided evidence regions are schema-validated before use.
- Keep remote media downloaded and validated locally even when a passthrough setting exists; this preserves the safer default and avoids blindly forwarding arbitrary URLs.
- Persist explicit setup credentials under `~/.sidesight/config.json` with `0700`/`0600` permissions; `SIDESIGHT_ALLOWED_DIRS` remains optional because the current working directory is the default allowlist.
- Use npm OIDC trusted publishing from `.github/workflows/publish.yml`; no long-lived npm token is referenced.

## Blockers

- `npm whoami` returns 401, so the initial local publish cannot run until an npm account is authenticated.
- This checkout has no `.git` directory or configured GitHub remote, and no `sidesight` repository was found under the authenticated GitHub user/orgs. The exact owner/repository is required for npm trusted-publisher configuration.

## Next task

- Authenticate npm, publish `sidesight@0.1.0`, then connect the exact GitHub repository to the trusted publisher and push a matching `v0.1.0` tag.
