# Worklog

## Current status

- Current phase: npm distribution and release automation
- Current task: None; the `v0.1.1` trusted-publisher release succeeded
- Overall status: `sidesight@0.1.1` is published and the GitHub Actions tag workflow is verified

## Completed

- Read the repository instructions and the full PRD.
- Reviewed the public Z.AI Vision MCP documentation and the independent MIT-licensed `vision-mcp` reference for tool names, image handling, zoom, and video behavior.
- Implemented the strict TypeScript CLI, shared core, generic OpenAI-compatible provider, `opencode-go` profile, security boundary, MCP adapter, skill, installer, docs, and validation scripts.
- Added rerunnable `sidesight setup` with secure `~/.sidesight/config.json` persistence for base URL, model, and API key; saved keys are redacted from `config show`.
- Kept `SIDESIGHT_ALLOWED_DIRS` optional: current working directory is the default, and extra directories can be explicitly added when needed.
- Added deterministic image, video, security, provider, CLI, MCP, acceptance, skill, and clean-package tests.
- Added public npm publish metadata, version-aware package smoke checks, the tag-triggered OIDC publish workflow, and release instructions.
- Published and verified the initial public `sidesight@0.1.0` package under the `ZhuXinAI/sidesight` repository.
- Made CLI and MCP versions resolve from the published package metadata so release versions cannot drift from `package.json`.
- Committed and pushed `v0.1.1`; GitHub Actions run `30691740343` published the package through OIDC trusted publishing.

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
  - Result: Initial `sidesight@0.1.0` publication verified on npm; `npm view sidesight version` reports `0.1.0`.
- Command: `pnpm test:pack` at version `0.1.1`
  - Result: Passed clean temporary install, correct CLI version, and mocked provider command smoke checks.
- Command: `npm publish --dry-run --access public` at version `0.1.1`
  - Result: Passed without npm metadata normalization warnings.
- Command: `pnpm test:integration` and `pnpm test:acceptance` at version `0.1.1`
  - Result: Passed; 3 integration tests and all acceptance checks succeeded.
- Command: GitHub Actions run `30691740343`
  - Result: Passed; checkout, pnpm setup, Node setup, frozen install, build, unit tests, and `npm publish` all succeeded.
- Command: `npm view sidesight@0.1.1 version dist.tarball gitHead --json`
  - Result: Passed; registry reports version `0.1.1`, tarball URL, and git head `c1ddb97`.
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
- Keep the organization workflow shape for the release smoke test: Node 24, frozen pnpm install, build, unit tests, and `npm publish` on `v*` tags.
- The workflow emitted only a non-blocking Node 20 deprecation annotation from `pnpm/action-setup@v4); the action was forced to run on the Node 24 runner and the publish succeeded.

## Blockers

- None.

## Next task

- Continue with the next versioned release when needed.
