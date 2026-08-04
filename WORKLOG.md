# Worklog

## Current status

- Current phase: v0.1.3 release complete
- Current task: None; cloud setup UX and explicit macOS local OCR are implemented and verified
- Overall status: `sidesight@0.1.3` is published from the validated native OCR and agent-first setup release

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
- Fixed the npm-bin entrypoint so direct execution through a `sidesight` symlink runs the CLI instead of exiting silently.
- Added root, command, and `config` subcommand help that does not resolve provider configuration.
- Updated the Agent Skill to request user-controlled `npx sidesight setup`, prohibit credential discovery scans, and explain local path, URL, data URI, clipboard, and host-attachment boundaries.
- Replaced the README's agent-facing Skills CLI command with the direct `SKILL.md` installation prompt and documented media handoff behavior.
- Prepared the `0.1.2` package version and release notes for the tag-triggered npm publication.
- Published `sidesight@0.1.2` from commit `130b987` through GitHub Actions run `30708949306` using npm OIDC trusted publishing.
- Made bare `npx sidesight setup` walk through base URL, model, and API key prompts; flag-bearing setup remains non-interactive for automation.
- Reviewed `oil-oil/see-skill` README, skill, onboarding flow, and macOS Vision bridge; adopted its agent-first setup conversation while preserving SideSight's CLI/core/MCP architecture.
- Added explicit `--provider local`, `--offline`, and `--ocr-backend system` OCR routing through the shared engine; local OCR never calls the cloud provider and does not require a saved key.
- Added the bundled `src/local/macos-vision-ocr.swift` bridge, secure temporary input handling, schema-validated OCR output, normalized evidence mapping, and actionable Swift/runtime errors.
- Updated the README and Agent Skill with the install prompt, direct agent usage examples, cloud setup boundary, and explicit local OCR exception.
- Prepared and published `sidesight@0.1.3` from commit `915dc1c` with annotated tag `v0.1.3`; GitHub Actions run `30911042716` completed the OIDC npm publication.

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
- Command: focused interactive setup unit test
  - Result: Passed; prompt order, hidden API-key intent, secure persistence, and secret redaction are covered.
- Command: `pnpm install --frozen-lockfile`
  - Result: Passed.
- Command: `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`
  - Result: Passed.
- Command: `pnpm test`
  - Result: 20 unit tests passed, including command/subcommand help and interactive setup coverage.
- Command: `pnpm build`
  - Result: Passed.
- Command: `pnpm test:integration`
  - Result: 3 mocked integration tests passed.
- Command: `pnpm test:acceptance`
  - Result: Passed CLI root/command/subcommand help, mocked diagnose, JSON output, interactive setup, and safe config display scenarios.
- Command: `pnpm test:pack`
  - Result: Passed clean temporary install, help/version, symlinked-bin help, and mocked provider command smoke checks.
- Command: `npm publish --dry-run --access public` at version `0.1.2`
  - Result: Passed.
- Command: GitHub Actions run `30708949306`
  - Result: Passed; tag `v0.1.2` built, tested, and published through OIDC trusted publishing.
- Command: `npm view sidesight@0.1.2 version dist.tarball gitHead --json`
  - Result: Passed; registry reports version `0.1.2`, tarball URL, and git head `130b987`.
- Command: `npx -y sidesight@0.1.2 --version` and `npx -y sidesight@0.1.2 --help` from `/tmp`
  - Result: Passed; clean external invocation reports `0.1.2` and the full command list.
- Command: pseudo-TTY setup smoke test
  - Result: Passed; base URL/model input is echoed, API-key input is masked, and the dummy key is absent from the terminal transcript.
- Command: `pnpm test:pack` after the interactive setup change
  - Result: Passed clean tarball installation, symlinked-bin help, and mocked provider command smoke checks.
- Command: `pnpm typecheck`
  - Result: Passed with no TypeScript errors after the local OCR route.
- Command: `pnpm vitest run src/local/ocr.test.ts src/cli.test.ts test/skill.test.ts`
  - Result: Passed; 9 focused tests covered local routing, no cloud invocation, crop evidence mapping, help, and skill guidance.
- Command: `pnpm build`
  - Result: Passed; `dist/local/macos-vision-ocr.swift` is copied as a runtime asset.
- Command: `pnpm test:acceptance`
  - Result: Passed; real macOS Vision OCR, offline aliases, no-provider-request behavior, mocked cloud diagnosis, and setup flows verified.
- Command: `pnpm test:pack`
  - Result: Passed; clean package install verified and tarball inspection confirmed the local OCR runtime asset.
- Command: `npm publish --dry-run --access public` at version `0.1.3`
  - Result: Passed; tarball contains the local OCR runtime asset and package metadata for `0.1.3`.
- Command: GitHub Actions run `30911042716`
  - Result: Passed; tag `v0.1.3` installed dependencies, built, ran unit tests, and published through OIDC trusted publishing.
- Command: `npm view sidesight@0.1.3 version dist.tarball gitHead --json`
  - Result: Passed; registry reports version `0.1.3`, the release tarball, and git head `915dc1c`.
- Command: `npx -y sidesight@0.1.3 --version` and `npx -y sidesight@0.1.3 --help` from `/tmp`
  - Result: Passed; clean external invocation reports `0.1.3` and the local/offline OCR setup guidance.

## Files changed

- `src/` shared core, provider, CLI, doctor, and MCP implementation.
- `skills/`, `.agents/`, and skill installer.
- `scripts/` build, lint, format, acceptance, live, and packaging checks.
- `README.md`, `TASKS.md`, `ACCEPTANCE.md`, `WORKLOG.md`, and package metadata.
- `src/local/macos-vision-ocr.swift`, `src/local/ocr.ts`, `src/local/ocr.test.ts`, `src/core/engine.ts`, `src/core/types.ts`, `src/core/errors.ts`, `src/config.ts`, `src/cli.ts`, `src/cli.test.ts`, `scripts/build.mjs`, `scripts/pack.mjs`, `skills/sidesight/SKILL.md`, and the CLI/skill acceptance coverage.

## Decisions

- Use a single strict TypeScript package with explicit `core`, `providers`, `config`, `cli`, and `mcp` boundaries. This keeps the executable easy to install while preserving the PRD’s shared-engine architecture.
- Use the canonical `SIDESIGHT_*` environment variables. The reference project’s `VISION_*` names are not copied into the public contract.
- Use bounded overview plus full-resolution crops for detail inspection; model-provided evidence regions are schema-validated before use.
- Keep remote media downloaded and validated locally even when a passthrough setting exists; this preserves the safer default and avoids blindly forwarding arbitrary URLs.
- Persist explicit setup credentials under `~/.sidesight/config.json` with `0700`/`0600` permissions; `SIDESIGHT_ALLOWED_DIRS` remains optional because the current working directory is the default allowlist.
- Use npm OIDC trusted publishing from `.github/workflows/publish.yml`; no long-lived npm token is referenced.
- Keep the organization workflow shape for the release smoke test: Node 24, frozen pnpm install, build, unit tests, and `npm publish` on `v*` tags.
- The workflow emitted only a non-blocking Node 20 deprecation annotation from `pnpm/action-setup@v4); the action was forced to run on the Node 24 runner and the publish succeeded.
- Use the repository's existing tag-triggered OIDC workflow; do not publish from a long-lived local npm token.
- Keep native OCR opt-in and narrow: explicit local/offline/system requests use macOS Vision for OCR only; missing setup must not silently downgrade richer visual tasks.
- Keep the Swift bridge as a packaged runtime asset and invoke it with `execFile` plus a restricted environment; never pass cloud credentials or shell-expanded media paths to it.

## Blockers

- None.

## Next task

- No follow-up task for this scope; live cloud-provider checks remain opt-in.
